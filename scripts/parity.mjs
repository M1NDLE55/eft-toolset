#!/usr/bin/env node
// Compares two deployments of the site: a baseline (production, or the Next.js app from master run
// locally) and a candidate (this app under `wrangler dev`, or a preview). It checks that both answer
// the same way:
//
// - MCP: the handshake (server info, capabilities, instructions), tools/list, prompts, every tool
//   with a set of calls that covers each one (later calls reuse earlier results, such as share
//   links), input errors, an unknown tool, and the HTTP edges (sign-in challenges, ChatGPT's
//   tool-result challenge, GET/DELETE, preflight, batches, notifications).
// - Pages: status, redirect target, head tags (title, description, canonical, robots, Open Graph,
//   Twitter), structured data, the h1 and the page's visible text, in PVP and in PVE.
//
// Both sides must read the same tarkov.dev data for prices to match: run them against the same
// stand-in (scripts/mcp-load.mjs --serve-only) or compare against production within minutes.
//
//   node scripts/parity.mjs --baseline http://127.0.0.1:3000 --candidate http://127.0.0.1:8787 \
//        --token <access token> [--candidate-token <token>] [--pages 60] [--json report.json]
//
// --token is sent to both unless --candidate-token is given (production and a local candidate need
// tokens from different issuers). Values that differ with time alone are normalised before
// comparing: dataAsOf, priceSource.ageSeconds, request references in error messages, and the
// instance state get_data_status reports. Exits non-zero when anything differs.

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const { values: args } = parseArgs({
  options: {
    baseline: { type: "string" },
    candidate: { type: "string" },
    token: { type: "string" },
    "candidate-token": { type: "string" },
    pages: { type: "string", default: "60" },
    json: { type: "string" },
    only: { type: "string" },
  },
});
if (!args.baseline || !args.candidate) throw new Error("Give --baseline and --candidate origins.");
const SIDES = {
  baseline: { origin: args.baseline.replace(/\/$/, ""), token: args.token },
  candidate: { origin: args.candidate.replace(/\/$/, ""), token: args["candidate-token"] ?? args.token },
};
const results = [];

// ---------- helpers ----------

/** A JSON-RPC response from a JSON or SSE body. */
async function readRpc(response) {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const messages = text
      .split(/\r?\n\r?\n/)
      .map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"))
      .filter(Boolean)
      .map((data) => JSON.parse(data));
    return messages.find((message) => "result" in message || "error" in message) ?? null;
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { unparsed: text.slice(0, 200) };
  }
}

async function mcp(side, body, { token = SIDES[side].token, headers = {}, method = "POST" } = {}) {
  const response = await fetch(`${SIDES[side].origin}/api/mcp`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, headers: response.headers, body: method === "POST" || response.status !== 204 ? await readRpc(response) : null };
}

/** Values that differ between two runs of the same code: when data was confirmed, request ids. */
function normalise(value, path = "") {
  if (Array.isArray(value)) return value.map((entry, index) => normalise(entry, `${path}[${index}]`));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "dataAsOf") out[key] = "<time>";
      // Made fresh on every call: ids and creation times of what an import link bundles.
      else if ((key === "createdAt" || key === "updatedAt") && typeof entry === "number") out[key] = "<time>";
      else if (key === "ageSeconds") out[key] = "<age>";
      else out[key] = normalise(entry, `${path}.${key}`);
    }
    return out;
  }
  if (typeof value === "string" && value.startsWith("{")) {
    try {
      return normalise(JSON.parse(value), path);
    } catch {
      // Not JSON: compared as text.
    }
  }
  if (typeof value === "string" && /#import=gz\./.test(value)) return decodeImportLink(value);
  if (typeof value === "string") {
    return value
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "<uuid>")
      .replace(/Reference: [0-9a-f]{8}/g, "Reference: <id>")
      .replace(/"dataAsOf":"[^"]*"/g, '"dataAsOf":"<time>"')
      .replace(/"ageSeconds":\d+/g, '"ageSeconds":"<age>"');
  }
  return value;
}

/** An import link's payload, decoded, with its export time removed: the gzip bytes differ between runtimes. */
function decodeImportLink(link) {
  const encoded = link.slice(link.indexOf("#import=gz.") + "#import=gz.".length);
  try {
    const json = JSON.parse(gunzipSync(Buffer.from(encoded, "base64url")).toString("utf8"));
    delete json.exportedAt;
    return { importLink: link.slice(0, link.indexOf("#import=")), payload: normalise(json) };
  } catch {
    return link;
  }
}

function differences(a, b, path = "", out = []) {
  if (out.length >= 8) return out;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    out.push(`${path || "<root>"}: ${JSON.stringify(a)?.slice(0, 160)} != ${JSON.stringify(b)?.slice(0, 160)}`);
    return out;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) differences(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && typeof a === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) out.push(`${path}.${key}: missing in baseline`);
      else if (!(key in b)) out.push(`${path}.${key}: missing in candidate`);
      else differences(a[key], b[key], `${path}.${key}`, out);
    }
    return out;
  }
  if (a !== b) out.push(`${path || "<root>"}: ${JSON.stringify(a)?.slice(0, 160)} != ${JSON.stringify(b)?.slice(0, 160)}`);
  return out;
}

function record(group, name, baseline, candidate, note) {
  const diff = differences(normalise(baseline), normalise(candidate));
  results.push({ group, name, same: diff.length === 0, diff, note });
  const mark = diff.length === 0 ? "same" : "DIFF";
  console.log(`${mark.padEnd(4)} ${group} ${name}${diff.length ? `\n       ${diff.join("\n       ")}` : ""}`);
}

const pick = (headers, names) => Object.fromEntries(names.map((name) => [name, headers.get(name)]));

// ---------- MCP ----------

async function both(fn) {
  return Promise.all([fn("baseline"), fn("candidate")]);
}

async function compareRpc(group, name, body, options) {
  const [a, b] = await both((side) => mcp(side, body, options));
  record(group, name, { status: a.status, body: a.body }, { status: b.status, body: b.body });
  return a.body;
}

async function toolCall(name, toolArgs, label = name) {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArgs } };
  const [a, b] = await both((side) => mcp(side, body));
  const view = (r) => ({ status: r.status, isError: r.body?.result?.isError ?? false, result: r.body?.result ?? r.body?.error });
  record("tool", label, view(a), view(b));
  return a.body?.result?.structuredContent;
}

async function mcpChecks() {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parity", version: "1" } },
  };
  await compareRpc("mcp", "initialize", init);
  await compareRpc("mcp", "tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list" });
  await compareRpc("mcp", "prompts/list", { jsonrpc: "2.0", id: 3, method: "prompts/list" });
  await compareRpc("mcp", "prompts/get build_weapon", {
    jsonrpc: "2.0",
    id: 4,
    method: "prompts/get",
    params: { name: "build_weapon", arguments: { weapon: "M4A1", goal: "recoil", gameMode: "pve" } },
  });
  await compareRpc("mcp", "ping", { jsonrpc: "2.0", id: 5, method: "ping" });

  // HTTP edges. Header values that name the server's own URL differ only by origin.
  const httpView = (r, names) => ({ status: r.status, headers: pick(r.headers, names), body: r.body });
  const noToken = await both((side) => mcp(side, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: null }));
  record("http", "no token: 401 challenge", httpView(noToken[0], ["www-authenticate", "cache-control"]), httpView(noToken[1], ["www-authenticate", "cache-control"]));
  const badToken = await both((side) => mcp(side, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: "not-a-token" }));
  record("http", "bad token: invalid_token", httpView(badToken[0], ["www-authenticate"]), httpView(badToken[1], ["www-authenticate"]));
  const chatgpt = await both((side) =>
    mcp(side, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_maps", arguments: {}, _meta: { "openai/userAgent": "x" } } }, { token: null })
  );
  record("http", "ChatGPT tool-call challenge", httpView(chatgpt[0], []), httpView(chatgpt[1], []));
  for (const method of ["GET", "DELETE"]) {
    const r = await both((side) => mcp(side, null, { method }));
    record("http", `${method} /api/mcp`, httpView(r[0], ["allow"]), httpView(r[1], ["allow"]));
  }
  const preflight = await both(async (side) => {
    const response = await fetch(`${SIDES[side].origin}/api/mcp`, { method: "OPTIONS", headers: { origin: "http://localhost:6274", "access-control-request-method": "POST" } });
    return { status: response.status, headers: pick(response.headers, ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers"]) };
  });
  record("http", "OPTIONS preflight (localhost)", preflight[0], preflight[1]);
  const foreign = await both((side) => mcp(side, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { headers: { origin: "https://evil.example" } }));
  record("http", "foreign Origin: 403", httpView(foreign[0], []), httpView(foreign[1], []));
  const batch = await both((side) => mcp(side, [{ jsonrpc: "2.0", id: 1, method: "ping" }]));
  record("http", "batch: 400", httpView(batch[0], []), httpView(batch[1], []));
  const notification = await both((side) => mcp(side, { jsonrpc: "2.0", method: "notifications/initialized" }));
  record("http", "notification: 202", { status: notification[0].status }, { status: notification[1].status });
  const parse = await both(async (side) => {
    const response = await fetch(`${SIDES[side].origin}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${SIDES[side].token}` },
      body: "{not json",
    });
    return { status: response.status, body: await readRpc(response) };
  });
  record("http", "unparseable body: 400", parse[0], parse[1]);
  const metadata = await both(async (side) => {
    const response = await fetch(`${SIDES[side].origin}/.well-known/oauth-protected-resource/api/mcp`);
    return { status: response.status, body: await response.json() };
  });
  record("http", "protected resource metadata", metadata[0], metadata[1]);
}

async function toolChecks() {
  // Items
  await toolCall("search_items", { query: "salewa" });
  await toolCall("search_items", { query: "ledx" }, "search_items typo-free short name");
  await toolCall("search_items", { query: "slewa" }, "search_items fuzzy");
  await toolCall("search_items", { category: "Keys", limit: 5, compact: true }, "search_items category");
  await toolCall("search_items", { caliber: "5.56x45mm", gameMode: "pve", limit: 5 }, "search_items caliber pve");
  await toolCall("get_item", { item: "Salewa first aid kit" });
  await toolCall("get_item", { item: "LEDX", include: ["tasks", "hideout", "barters", "crafts"] }, "get_item all relations");
  await toolCall("get_item", { item: "dorm room 314 marked key", gameMode: "pve" }, "get_item key pve");
  await toolCall("get_item", { item: "red" }, "get_item ambiguous");
  await toolCall("get_item_prices", { items: ["Salewa", "LEDX", "2x Graphics card", "Bolts"], sortBy: "valuePerSlot", includeDiscordText: true });
  await toolCall("get_item_prices", { items: ["Salewa"], gameMode: "pve" }, "get_item_prices pve");
  // Gun builder
  await toolCall("list_weapons", { query: "m4", limit: 5 });
  await toolCall("list_weapons", { caliber: "7.62x39mm", gameMode: "pve" }, "list_weapons caliber pve");
  const weapon = await toolCall("get_weapon", { weapon: "M4A1" });
  await toolCall("get_weapon", { weapon: "AKM", gameMode: "pve", priceSources: { maxTraderLevel: 2 } }, "get_weapon pve trader levels");
  const shareLink = weapon?.defaultPreset?.shareLink ?? weapon?.build?.shareLink ?? weapon?.shareLink;
  const build = shareLink ? { shareLink } : { weapon: "M4A1", preset: "default" };
  const evaluated = await toolCall("evaluate_build", { build, includeShoppingList: true, includeDiscordText: true });
  const firstSlot = evaluated?.parts?.[0]?.slotPath;
  if (firstSlot) await toolCall("get_slot_options", { build, slotPath: firstSlot, limit: 5 });
  await toolCall("get_ammo_options", { build, limit: 5 });
  const modified = await toolCall("modify_build", { build, changes: [{ action: "set_ammo", item: "M855A1" }, { action: "fill_required" }] });
  await toolCall("optimize_build", { build: { weapon: "M4A1", preset: "default" }, goal: "recoil", budgetRUB: 150000 });
  if (modified?.shareLink) await toolCall("compare_builds", { left: build, right: { shareLink: modified.shareLink } });
  await toolCall("evaluate_build", { build: { weapon: "no such gun" } }, "evaluate_build invalid weapon");
  // Raid planner
  await toolCall("list_maps", {});
  await toolCall("get_map_details", { map: "customs" });
  await toolCall("get_map_details", { map: "Interchange", sections: ["locks", "spawns"], spawnKinds: ["pmc"], gameMode: "pve" }, "get_map_details sections pve");
  const plan = await toolCall("create_raid_plan", {
    map: "customs",
    name: "Parity",
    route: [{ place: "Dorms" }, { x: 100, z: -50 }],
    notes: [{ at: { place: "Dorms" }, title: "Keys", body: "Marked room" }],
    drawings: [{ kind: "arrow", points: [{ x: 0, z: 0 }, { x: 50, z: 50 }] }],
  });
  if (plan?.shareLink) await toolCall("read_raid_plan", { link: plan.shareLink });
  // Glossary, wiki, import, status
  await toolCall("lookup_term", { terms: ["Big Red", "Tetris", "M995", "FIR"] });
  await toolCall("lookup_term", { category: "boss" }, "lookup_term category");
  await toolCall("get_wiki_page", { page: "Reshala" });
  await toolCall("get_wiki_page", { page: "Customs", sections: ["Extraction"] }, "get_wiki_page section");
  await toolCall("get_wiki_page", { page: "M4A1" }, "get_wiki_page left out");
  await toolCall("create_import_link", {
    itemGroups: [{ name: "Loot", items: ["Salewa", "LEDX"] }],
    builds: [build],
    ...(plan?.shareLink ? { raidPlans: [{ link: plan.shareLink }] } : {}),
  });
  // Errors the SDK produces
  await toolCall("get_item", {}, "get_item missing argument");
  await toolCall("get_item", { item: 5 }, "get_item wrong type");
  await toolCall("no_such_tool", {}, "unknown tool");
  // get_data_status reports this instance's caches: only its shape is compared.
  const status = await both((side) => mcp(side, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_data_status", arguments: {} } }));
  const shape = (value) =>
    Array.isArray(value) ? value.slice(0, 1).map(shape) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])])) : typeof value;
  record("tool", "get_data_status (shape)", shape(status[0].body?.result?.structuredContent), shape(status[1].body?.result?.structuredContent));
}

// ---------- pages ----------

function headTags(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
  const tags = [];
  const title = head.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  if (title !== undefined) tags.push(`title=${title}`);
  for (const match of head.matchAll(/<meta\s+([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
    const key = attrs.name ?? attrs.property;
    if (!key || ["viewport", "theme-color", "color-scheme", "next-size-adjust"].includes(key)) continue;
    tags.push(`${key}=${attrs.content}`);
  }
  for (const match of head.matchAll(/<link\s+([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
    if (attrs.rel === "canonical" || attrs.rel === "manifest") tags.push(`${attrs.rel}=${attrs.href}`);
  }
  return tags.map((tag) => tag.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

function structuredData(html) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      return m[1];
    }
  });
}

/**
 * The page's distinct text, one entry per run of text between tags, sorted. Next streamed parts of
 * a page to the end of the body (after a Suspense fallback holding the same text), so neither the
 * order nor the count of a text in its HTML says what the page shows.
 */
function visibleText(html) {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? html;
  const texts = body
    .replace(/<script[\s\S]*?<\/script>/g, "<>")
    .replace(/<style[\s\S]*?<\/style>/g, "<>")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]*>/)
    .map((text) =>
      text
        .replace(/&nbsp;/g, " ")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  return [...new Set(texts)].sort();
}

async function page(side, path, gameMode) {
  const response = await fetch(`${SIDES[side].origin}${path}`, {
    redirect: "manual",
    headers: gameMode === "pve" ? { cookie: "eft-game-mode=pve" } : {},
  });
  const html = await response.text();
  const location = response.headers.get("location");
  return {
    status: response.status,
    // Next sent some redirects' Location twice, which fetch joins with a comma.
    location: location ? [...new Set(location.split(", "))].join(", ").replace(SIDES[side].origin, "") : null,
    head: response.status < 300 ? headTags(html) : [],
    jsonLd: response.status < 300 ? structuredData(html) : [],
    h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).sort(),
    text: visibleText(html),
  };
}

/** The text only one side shows, as two lists (a multiset difference). */
function textDiff(a, b) {
  const counts = new Map();
  for (const text of a) counts.set(text, (counts.get(text) ?? 0) + 1);
  const onlyCandidate = [];
  for (const text of b) {
    const left = counts.get(text) ?? 0;
    if (left > 0) counts.set(text, left - 1);
    else onlyCandidate.push(text);
  }
  const onlyBaseline = [...counts].flatMap(([text, count]) => Array(count).fill(text));
  return onlyBaseline.length || onlyCandidate.length ? { onlyBaseline, onlyCandidate } : null;
}

const FIXED_PAGES = [
  "/",
  "/item",
  "/item-groups",
  "/gun-builder",
  "/gun-builder/best",
  "/gun-builder/gunsmith",
  "/gun-builder/compare",
  "/ammo",
  "/keys",
  "/quests",
  "/flea-market/pve",
  "/raid-planner",
  "/mcp",
  "/credits",
  "/policies/disclaimer-and-use-policy",
  "/settings",
  "/data",
  "/gun-builder/someid",
  "/gun-builder/someid/list",
  "/gun-builder/share/m4a1",
  "/raid-planner/someid",
  "/raid-planner/share/plan",
  "/item-groups/My-group",
  "/item/Salewa%20first%20aid%20kit",
  "/item/no-such-item-at-all",
  "/quests/no-such-quest",
  "/ammo/no-such-calibre",
  "/keys/no-such-map",
  "/raid-planner/map/no-such-map",
  "/gun-builder/best/no-such-gun",
  "/pve/item",
  "/pve/quests/debut",
  "/no-such-page",
];

async function pageChecks() {
  const sitemap = await (await fetch(`${SIDES.baseline.origin}/sitemap.xml`)).text();
  const urls = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
  const byKind = new Map();
  for (const url of urls) {
    const kind = url.split("/").slice(0, url.startsWith("/gun-builder/") ? 3 : 2).join("/");
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(url);
  }
  // A spread of every kind of page in the sitemap: every nth of each kind, so the sample is the same each run.
  const budget = Number(args.pages);
  const sample = [];
  for (const list of byKind.values()) {
    const take = Math.max(2, Math.ceil((budget * list.length) / urls.length));
    const step = Math.max(1, Math.floor(list.length / take));
    for (let i = 0; i < list.length && sample.length < budget * 2; i += step) sample.push(list[i]);
  }
  const paths = [...new Set([...FIXED_PAGES, ...sample])];
  console.log(`pages: ${paths.length} paths (${urls.length} in the sitemap), each in PVP and PVE`);
  for (const gameMode of ["regular", "pve"]) {
    for (const path of paths) {
      const [a, b] = await both((side) => page(side, path, gameMode));
      const diff = textDiff(a.text, b.text);
      record(`page ${gameMode}`, path, { ...a, text: undefined }, { ...b, text: undefined }, undefined);
      const last = results.at(-1);
      if (diff) {
        last.same = false;
        const show = (list) => list.slice(0, 6).map((text) => JSON.stringify(text.slice(0, 80))).join(", ") + (list.length > 6 ? ` (+${list.length - 6})` : "");
        last.diff.push(`text only in baseline: ${show(diff.onlyBaseline)}`, `text only in candidate: ${show(diff.onlyCandidate)}`);
        console.log(`       text only in baseline: ${show(diff.onlyBaseline)}\n       text only in candidate: ${show(diff.onlyCandidate)}`);
      }
    }
  }
  const [robotsA, robotsB] = await both(async (side) => (await fetch(`${SIDES[side].origin}/robots.txt`)).text());
  record("file", "/robots.txt", robotsA, robotsB);
  const [mapA, mapB] = await both(async (side) => (await fetch(`${SIDES[side].origin}/sitemap.xml`)).text());
  record("file", "/sitemap.xml", mapA, mapB);
  const [manifestA, manifestB] = await both(async (side) => (await fetch(`${SIDES[side].origin}/manifest.webmanifest`)).json());
  record("file", "/manifest.webmanifest", manifestA, manifestB);
}

// ---------- run ----------

const only = args.only?.split(",");
if (!only || only.includes("mcp")) await mcpChecks();
if (!only || only.includes("tools")) await toolChecks();
if (!only || only.includes("pages")) await pageChecks();

const summary = {};
for (const result of results) {
  const group = result.group.split(" ")[0];
  summary[group] ??= { checks: 0, same: 0, different: 0 };
  summary[group].checks += 1;
  summary[group][result.same ? "same" : "different"] += 1;
}
console.log(`\n${JSON.stringify(summary, null, 2)}`);
if (args.json) await writeFile(args.json, JSON.stringify({ summary, results }, null, 2));
process.exitCode = results.every((result) => result.same) ? 0 : 1;
