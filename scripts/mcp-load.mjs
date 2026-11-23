// Load test for the MCP endpoint (/api/mcp) against a stand-in tarkov.dev, a fake AuthKit issuer and a
// small caching reverse proxy that plays the site's CDN.
//
// Usage (Node 24, no extra deps; build the app first with `npx next build`):
//
//   node scripts/mcp-load.mjs --upstream-dir <dir> --start <app dir> [options]
//   node scripts/mcp-load.mjs --upstream-dir <dir> --url http://127.0.0.1:3000/api/mcp \
//        --upstream-port 4100 --issuer-port 4101 [options]
//
// <dir> holds tarkov.dev's JSON as <mode>-<resource>.json (modes regular and pve). With --start the
// script runs `npx next start` in <app dir> (once per --instances, on consecutive ports from --port) with
// TARKOV_UPSTREAM_URL, MCP_AUTHKIT_DOMAIN, MCP_RESOURCE_URL and PRICE_FEED_ORIGIN pointing at its own
// servers, samples each instance's RSS, and kills them at the end. With --url the app must already run
// with TARKOV_UPSTREAM_URL=http://127.0.0.1:<upstream-port>, MCP_AUTHKIT_DOMAIN=http://127.0.0.1:<issuer-port>
// and MCP_RESOURCE_URL=<url> (or pass --no-auth for a development server without sign-in).
//
// Only tarkov.dev's JSON API is stood in. The app does not use tarkov.dev's GraphQL API, so there is no
// GraphQL stand-in.
//
// The CDN stand-in: a reverse proxy in front of the instances (round-robin) that caches GET responses
// keyed on the full URL (plus the accept-encoding bucket, like a CDN that varies on encoding), honouring
// Cache-Control s-maxage (else max-age) and stale-while-revalidate: fresh -> HIT, within the
// stale-while-revalidate window -> STALE plus one background revalidation, otherwise MISS (concurrent
// misses share one origin request, counted as "coalesced"). private/no-store/no-cache or Set-Cookie
// responses are not cached. It listens on one port per instance so it can tell which instance asked;
// instance k gets PRICE_FEED_ORIGIN=http://127.0.0.1:<cdn port k>. Requests whose path and query match
// --feed-path count as price feed requests. Each instance also gets its own upstream prefix
// (TARKOV_UPSTREAM_URL=<upstream>/i<k>) so upstream traffic is attributed per instance.
//
//   --scenario <name>       healthy | cold-upstream-down | flaky | slow | hang          (fault presets)
//                           prices | search | build | feed-down | upstream-down | items-down | cold
//                           (workload presets; see SCENARIOS below; explicit options still win)
//   --instances <n>         app processes with --start, on ports --port .. --port+n-1 (default 1, cold 3);
//                           agents are spread across them round-robin
//   --agents <n>            simulated agents, each with its own token sub (default 12)
//   --calls <n>             tool calls per agent (default 10)
//   --burst <a-b>           calls an agent sends at once, like parallel tool calls (default 1-3)
//   --think <a-b>           ms an agent pauses between bursts (default 500-2500; cold-upstream-down 3000-7000)
//   --rate <tokens/s>       client-side pacing per instance against its global MCP budget (default 3.5)
//   --rate-burst <tokens>   pacing bucket size per instance (default 200; the server's is 240)
//   --max-inflight <n>      requests in flight at once per instance (default 6, the server's tool-call cap)
//   --retries <n>           retries of a 429 after its Retry-After (default 2)
//   --timeout <ms>          client timeout per request (default 65000; tools stop at 40 s)
//   --mix k=w,...           tool weights (default search_items=35,get_item=20,get_item_prices=20,
//                           get_weapon=10,evaluate_build=8,modify_build=7)
//   --price-set <name>      get_item_prices arguments: default (5-20 hand-picked names) or real200
//                           (1-5 names from a fixed set of 200 real English item names derived from
//                           <dir>/regular-items.json + regular-items_en.json; the prices scenario uses it)
//   --eager                 each instance's agents start as soon as that instance answers (cold does this)
//   --no-handshake          skip initialize + notifications/initialized per agent
//   --port <n>              first app port with --start (default 3100)
//   --upstream-port <n>     stand-in upstream port (default random)
//   --issuer-port <n>       fake AuthKit port (default random)
//   --cdn-port <n>          first CDN stand-in port (default random; one port per instance)
//   --feed-path <regex>     pattern (case-insensitive) matched against the path and query of CDN requests
//                           that are price feed fetches (default "price"; the feed is /api/tarkov?op=price.feed)
//   --token-ttl <s>         access token lifetime (default 300; re-minted before expiry)
//   --ready-timeout <ms>    wait for the app to answer (default 60000)
//   --settle <ms>           wait after the app answers before load starts (default 0)
//   --server-log <path>     app stdout/stderr with --start (default a temp file); with several instances
//                           instance k writes <path minus .log>.<k>.log
//   --json <path>           also write the report as JSON to this file
//   --serve-only            start only the stand-in upstream, the CDN (no origin) and the issuer, print
//                           the app's env and a token, and run until Ctrl-C (for starting the app by hand)
//   Upstream injection (override the scenario's settings):
//   --latency <ms>          fixed delay per upstream response    --jitter <ms>   extra random delay
//   --fail-rate <0..1>      share of upstream requests answered 502
//   --down-for <s>          upstream answers 502 for the first s seconds (from app start with --start)
//   --upstream-down         every upstream resource answers 502 (from --down-after)
//   --items-down            only the bulk items file (<mode>/items) answers 502 (from --down-after)
//   --down-after <s>        seconds after load start that --upstream-down / --items-down begin
//                           (default 0: from the start, app start included)
//   --feed-down             the CDN answers 502 for the price feed path (exercises the bulk fallback)
//   --hang                  upstream never answers
//   --items-etag-every <s>  items gets a new ETag every s seconds (prices change ~5 min upstream)
//   --br-quality <0..11>    brotli quality for the precompressed bodies (default 5)
//
// The report splits upstream traffic into bulk items downloads (<mode>/items: 200 vs 304, wire bytes)
// and other datasets, and price feed traffic at the CDN (instance requests, CDN hits vs origin fetches,
// bytes). Its "summary" block is what SCRATCH-style compare scripts read.
//
// Prints a table and the JSON report; exits 0 unless the harness itself failed.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, createWriteStream, writeFileSync, existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzipSync } from "node:zlib";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const MODES = ["regular", "pve"];
const RESOURCES = [
  "items", "items_en", "tasks", "tasks_en", "traders", "traders_en",
  "barters", "crafts", "hideout", "hideout_en", "maps", "maps_en",
];
const PROTOCOL_VERSION = "2025-06-18";
const TOOL_COSTS = { modify_build: 2, optimize_build: 3 };

// ---------- options ----------

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(`--${name}`);
}
function opt(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}
function num(name, fallback) {
  const raw = opt(name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}
function range(name, fallback) {
  const raw = opt(name, undefined);
  if (raw === undefined) return fallback;
  const [a, b = a] = raw.split("-").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`--${name} must look like 1-3`);
  return [Math.min(a, b), Math.max(a, b)];
}

const DEFAULT_MIX = "search_items=35,get_item=20,get_item_prices=20,get_weapon=10,evaluate_build=8,modify_build=7";
const SCENARIOS = {
  healthy: {},
  "cold-upstream-down": { downForS: 20, think: [3000, 7000] },
  flaky: { failRate: 0.2, latencyMs: 300 },
  slow: { latencyMs: 8000 },
  hang: { hang: true },
  // 1,000 price calls (20 agents x 50) over a fixed set of 200 real names, 1-5 names per call; ~75 s so a
  // 60 s feed s-maxage expires once.
  prices: { mix: "get_item_prices=1", priceSet: "real200", agents: 20, calls: 50, burst: [1, 3], think: [1500, 3500] },
  // search_items bursts of 5-10 parallel calls.
  search: { mix: "search_items=1", agents: 6, calls: 40, burst: [5, 10], think: [1000, 3000] },
  build: { mix: "get_weapon=4,evaluate_build=3,modify_build=3", agents: 8, calls: 12, burst: [1, 2], think: [500, 2000] },
  // The CDN answers 502 for the price feed: instances must fall back to the bulk path.
  "feed-down": { feedDown: true, agents: 12, calls: 12 },
  // Everything upstream answers 502 once the apps are up (they load data lazily, so every refresh fails;
  // a later --down-after only bites after the 5 min items freshness): no hard failures while any copy
  // (deployment snapshot, CDN feed) exists.
  "upstream-down": { upstreamDown: true, agents: 12, calls: 15, think: [2000, 5000] },
  // Only the bulk items file answers 502; every other dataset is reachable.
  "items-down": { itemsDown: true, agents: 12, calls: 15, think: [2000, 5000] },
  // Three fresh instances; each instance's agents start as soon as it answers.
  cold: { instances: 3, eager: true, agents: 6, calls: 6, burst: [1, 2], think: [300, 1000] },
};
const scenarioName = opt("scenario", "healthy");
const scenario = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`Unknown --scenario ${scenarioName}; use ${Object.keys(SCENARIOS).join(", ")}`);

const config = {
  scenario: scenarioName,
  upstreamDir: opt("upstream-dir", undefined),
  start: opt("start", undefined),
  url: opt("url", undefined),
  instances: Math.max(1, num("instances", scenario.instances ?? 1)),
  port: num("port", 3100),
  upstreamPort: num("upstream-port", 0),
  issuerPort: num("issuer-port", 0),
  cdnPort: num("cdn-port", 0),
  feedPath: opt("feed-path", "price"),
  agents: num("agents", scenario.agents ?? 12),
  calls: num("calls", scenario.calls ?? 10),
  burst: range("burst", scenario.burst ?? [1, 3]),
  think: range("think", scenario.think ?? [500, 2500]),
  rate: num("rate", 3.5),
  rateBurst: num("rate-burst", 200),
  maxInflight: num("max-inflight", 6),
  retries: num("retries", 2),
  timeoutMs: num("timeout", 65_000),
  handshake: !flag("no-handshake"),
  auth: !flag("no-auth"),
  eager: flag("eager") || Boolean(scenario.eager),
  priceSet: opt("price-set", scenario.priceSet ?? "default"),
  tokenTtlS: num("token-ttl", 300),
  readyTimeoutMs: num("ready-timeout", 60_000),
  settleMs: num("settle", 0),
  serverLog: opt("server-log", undefined),
  jsonOut: opt("json", undefined),
  brQuality: num("br-quality", 5),
  inject: {
    latencyMs: num("latency", scenario.latencyMs ?? 0),
    jitterMs: num("jitter", scenario.jitterMs ?? 0),
    failRate: num("fail-rate", scenario.failRate ?? 0),
    downForS: num("down-for", scenario.downForS ?? 0),
    upstreamDown: flag("upstream-down") || Boolean(scenario.upstreamDown),
    itemsDown: flag("items-down") || Boolean(scenario.itemsDown),
    downAfterS: num("down-after", scenario.downAfterS ?? 0),
    feedDown: flag("feed-down") || Boolean(scenario.feedDown),
    hang: flag("hang") || Boolean(scenario.hang),
    itemsEtagEveryS: num("items-etag-every", 0),
  },
  mix: [], // parsed below, once the workloads exist
};
if (!config.upstreamDir) throw new Error("--upstream-dir is required");
if (!config.start && !config.url && !flag("serve-only")) throw new Error("Give --start <app dir> or --url <mcp url>");
if (config.url && config.instances > 1) throw new Error("--instances needs --start");
if (!["default", "real200"].includes(config.priceSet)) throw new Error("--price-set must be default or real200");
if (config.scenario === "cold-upstream-down" && !config.start) {
  console.warn("cold-upstream-down only measures a cold start with --start; the down window starts now.");
}
const feedPattern = new RegExp(config.feedPath, "i");

function parseMix(raw) {
  const mix = raw.split(",").map((part) => {
    const [name, weight] = part.split("=");
    if (!WORKLOADS[name]) throw new Error(`--mix: unknown tool ${name}`);
    return { name, weight: Number(weight) };
  });
  if (mix.some((entry) => !(entry.weight >= 0))) throw new Error("--mix weights must be numbers");
  return mix;
}

// ---------- workload ----------

const SEARCH_QUERIES = [
  "LEDX", "salewa", "salew", "graphics card", "graphic crad", "bitcoin", "bitcon", "propital", "propitol",
  "Tetriz", "gas analyzer", "corrugated hose", "wires", "slick", "red rebel", "ophthalmoscope", "ophtalmoscope",
  "tushonka", "moonshine", "grizzly", "M995", "M4A1", "keycard", "ifak", "morphine", "car battery", "gpu",
  "thermite", "dorm 314", "marked key", "AK-74", "paracord",
];
const ITEM_REFERENCES = [
  "LEDX Skin Transilluminator", "Salewa first aid kit", "Graphics card", "Physical Bitcoin", "Gas analyzer",
  "Corrugated hose", "Bundle of wires", "Propital", "Ophthalmoscope", "Can of beef stew (Large)", "Tetriz portable game console",
  "Morphine injector", "Car battery", "Red Rebel ice pick", "IFAK", "ledx", "M995", "Grizzly",
];
const PRICE_ITEMS = [
  "LEDX Skin Transilluminator", "Graphics card", "Physical Bitcoin", "Gas analyzer", "Corrugated hose", "Bundle of wires",
  "Propital", "Ophthalmoscope", "Tetriz", "Salewa", "Morphine", "Car battery", "Military power filter", "Military cable",
  "Virtex programmable processor", "Phased array element", "Tank battery", "Golden neck chain", "Roler Submariner",
  "Bronze lion figurine", "Fuel conditioner", "Expeditionary fuel tank", "Printed circuit board", "CPU fan",
  "Power supply unit", "Electric motor", "Military gyrotachometer", "Intelligence folder", "Hose", "Wires",
];
const WEAPONS = ["M4A1", "AKM", "AK-74N", "HK 416A5", "SV-98", "MP5", "SA-58", "RFB", "Saiga-12K 12ga automatic shotgun", "Glock 17"];

/**
 * 200 distinct real English item names: flea-priced, non-preset items whose English name is unique,
 * ordered by a hash of the id so the set is fixed for a given upstream copy.
 */
function deriveRealPriceNames(dir, count = 200) {
  const items = JSON.parse(readFileSync(join(dir, "regular-items.json"), "utf8")).data.items;
  const english = JSON.parse(readFileSync(join(dir, "regular-items_en.json"), "utf8")).data;
  const byName = new Map();
  for (const item of Object.values(items)) {
    const name = english[item.name];
    if (typeof name !== "string" || !name.trim()) continue;
    byName.set(name, byName.has(name) ? null : item);
  }
  return [...byName]
    .filter(([, item]) => item && item.lastLowPrice > 0 && !item.types.includes("preset"))
    .map(([name, item]) => ({ name, key: createHash("sha1").update(item.id).digest("hex") }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .slice(0, count)
    .map(({ name }) => name);
}
const REAL_PRICE_NAMES = config.priceSet === "real200" ? deriveRealPriceNames(resolve(config.upstreamDir)) : [];
if (config.priceSet === "real200" && REAL_PRICE_NAMES.length < 200) {
  throw new Error(`Only ${REAL_PRICE_NAMES.length} usable real item names in ${config.upstreamDir}`);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
function pickN(list, min, max) {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  return [...list].sort(() => Math.random() - 0.5).slice(0, Math.min(n, list.length));
}
const gameMode = () => (Math.random() < 0.7 ? "regular" : "pve");

const WORKLOADS = {
  search_items: () => ({ query: pick(SEARCH_QUERIES), gameMode: gameMode() }),
  get_item: () => ({ item: pick(ITEM_REFERENCES), gameMode: gameMode() }),
  get_item_prices: () =>
    config.priceSet === "real200"
      ? { items: pickN(REAL_PRICE_NAMES, 1, 5), gameMode: gameMode() }
      : { items: pickN(PRICE_ITEMS, 5, 20), gameMode: gameMode() },
  get_weapon: () => ({ weapon: pick(WEAPONS), gameMode: gameMode() }),
  evaluate_build: () => ({ build: { weapon: pick(WEAPONS), preset: "default" }, gameMode: gameMode() }),
  modify_build: () => ({ build: { weapon: pick(WEAPONS) }, changes: [{ action: "fill_required" }], gameMode: gameMode() }),
};

config.mix = parseMix(opt("mix", scenario.mix ?? DEFAULT_MIX));

function pickTool() {
  const total = config.mix.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of config.mix) {
    roll -= entry.weight;
    if (roll < 0) return entry.name;
  }
  return config.mix.at(-1).name;
}

// ---------- stand-in upstream ----------

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
let downAnchor = Date.now(); // reset to the first app's start with --start
let loadStartedAt = null; // set when the load starts; --down-after counts from here

function injectedDown(resource) {
  const { upstreamDown, itemsDown, downAfterS } = config.inject;
  if (!upstreamDown && !(itemsDown && resource === "items")) return false;
  if (downAfterS <= 0) return true;
  return loadStartedAt !== null && Date.now() - loadStartedAt >= downAfterS * 1000;
}

const newCounters = () => ({ requests: 0, ok200: 0, notModified: 0, failures: 0, hung: 0, wireBytes: 0, firstOkAt: null });

async function startUpstream() {
  const dir = resolve(config.upstreamDir);
  const files = new Map();
  const missing = [];
  const brotli = promisify(brotliCompress);
  const startedAt = Date.now();
  await Promise.all(
    MODES.flatMap((mode) =>
      RESOURCES.map(async (resource) => {
        const path = join(dir, `${mode}-${resource}.json`);
        if (!existsSync(path)) {
          missing.push(`${mode}-${resource}.json`);
          return;
        }
        const body = readFileSync(path);
        const br = await brotli(body, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: config.brQuality,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
            [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          },
        });
        files.set(`${mode}/${resource}`, {
          body,
          br,
          gzip: undefined,
          hash: createHash("sha1").update(body).digest("hex").slice(0, 24),
          lastModified: statSync(path).mtime.toUTCString(),
        });
      })
    )
  );
  if (missing.length) throw new Error(`Missing upstream files in ${dir}: ${missing.join(", ")}`);
  const precompressMs = Date.now() - startedAt;

  const stats = new Map(); // key -> counters
  const perInstance = new Map(); // instance -> { bulk: counters, other: counters }
  const timeline = []; // { t, key, instance, status, bytes }
  const acceptEncodings = new Map();
  const hung = new Set();
  const counter = (key) => {
    let entry = stats.get(key);
    if (!entry) {
      entry = newCounters();
      stats.set(key, entry);
    }
    return entry;
  };
  const instanceCounter = (instance, bulk) => {
    let entry = perInstance.get(instance);
    if (!entry) {
      entry = { bulk: newCounters(), other: newCounters() };
      perInstance.set(instance, entry);
    }
    return bulk ? entry.bulk : entry.other;
  };

  function etagFor(key, file) {
    const every = config.inject.itemsEtagEveryS;
    const generation = every > 0 && key.endsWith("/items") ? Math.floor((Date.now() - upstreamStartedAt) / (every * 1000)) : 0;
    return `W/"${file.hash}${generation ? `-${generation}` : ""}"`;
  }
  const upstreamStartedAt = Date.now();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://upstream");
    // Instances fetch through <upstream>/i<k>/<mode>/<resource>; --url setups use the bare path.
    const prefixed = /^\/i(\d+)(\/.*)$/.exec(url.pathname);
    const instance = prefixed ? Number(prefixed[1]) : 0;
    const [, mode, resource] = (prefixed ? prefixed[2] : url.pathname).split("/");
    const key = `${mode}/${resource}`;
    const file = files.get(key);
    const entry = counter(file ? key : "(unknown)");
    const byInstance = instanceCounter(instance, resource === "items");
    const both = (field, by = 1) => {
      entry[field] += by;
      byInstance[field] += by;
    };
    both("requests");
    const accept = String(req.headers["accept-encoding"] ?? "");
    acceptEncodings.set(accept, (acceptEncodings.get(accept) ?? 0) + 1);
    const t = Date.now();
    const finish = (status, bytes) => timeline.push({ t, key, instance, status, bytes });

    if (config.inject.hang) {
      both("hung");
      hung.add(res);
      res.on("close", () => hung.delete(res));
      finish("hang", 0);
      return;
    }
    const delay = config.inject.latencyMs + Math.random() * config.inject.jitterMs;
    if (delay > 0) await sleep(delay);
    if (res.destroyed) return;
    const down = (Date.now() - downAnchor) / 1000 < config.inject.downForS || injectedDown(resource);
    if (!file || down || Math.random() < config.inject.failRate) {
      const status = file ? 502 : 404;
      if (file) both("failures");
      const body = file ? "Bad gateway (stand-in)" : "Not found";
      res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      both("wireBytes", Buffer.byteLength(body));
      finish(status, Buffer.byteLength(body));
      return;
    }
    const etag = etagFor(key, file);
    const headers = {
      "Content-Type": "application/json",
      ETag: etag,
      "Last-Modified": file.lastModified,
      "Cache-Control": "max-age=691200",
      Vary: "accept-encoding",
    };
    const ifNoneMatch = req.headers["if-none-match"];
    const weak = (value) => value.trim().replace(/^W\//, "");
    const notModified = ifNoneMatch
      ? ifNoneMatch === "*" || ifNoneMatch.split(",").some((tag) => weak(tag) === weak(etag))
      : req.headers["if-modified-since"] && config.inject.itemsEtagEveryS === 0
        ? Date.parse(req.headers["if-modified-since"]) >= Date.parse(file.lastModified)
        : false;
    if (notModified) {
      both("notModified");
      res.writeHead(304, headers);
      res.end();
      finish(304, 0);
      return;
    }
    let body = file.body;
    if (/\bbr\b/.test(accept)) {
      body = file.br;
      headers["Content-Encoding"] = "br";
    } else if (/\bgzip\b/.test(accept)) {
      file.gzip ??= gzipSync(file.body, { level: 6 });
      body = file.gzip;
      headers["Content-Encoding"] = "gzip";
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(body);
    both("ok200");
    both("wireBytes", body.length);
    entry.firstOkAt ??= Date.now();
    byInstance.firstOkAt ??= Date.now();
    finish(200, body.length);
  });
  server.keepAliveTimeout = 5_000;
  await new Promise((resolveListen) => server.listen(config.upstreamPort, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    precompressMs,
    stats,
    perInstance,
    timeline,
    acceptEncodings,
    files,
    async close() {
      for (const res of hung) res.destroy();
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

// ---------- CDN stand-in ----------

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "proxy-connection", "upgrade", "te", "trailer"]);

function parseCacheControl(value) {
  const directives = {};
  for (const part of String(value ?? "").split(",")) {
    const [name, raw] = part.trim().split("=");
    if (!name) continue;
    directives[name.toLowerCase()] = raw === undefined ? true : Number(raw.replace(/"/g, ""));
  }
  return directives;
}

function encodingBucket(accept) {
  const value = String(accept ?? "");
  if (/\bbr\b/.test(value)) return "br";
  if (/\bgzip\b/.test(value)) return "gzip";
  return "identity";
}

/** Caching reverse proxy in front of the instances; one listening port per instance (requester). */
async function startCdn(instanceCount) {
  const originPorts = []; // filled in once the instances' ports are known
  const cache = new Map(); // key -> { status, headers, body, storedAt, freshMs, swrMs, etag }
  const misses = new Map(); // key -> Promise of an origin result
  const revalidating = new Set();
  let roundRobin = 0;
  const blank = () => ({
    requests: 0, hit: 0, stale: 0, miss: 0, coalesced: 0, pass: 0, notModifiedToClient: 0, failed: 0, feedDown: 0,
    clientBytes: 0, originRequests: 0, originNotModified: 0, originBytes: 0, revalidations: 0,
  });
  const totals = blank();
  const feed = blank();
  const perPath = new Map();
  const perRequester = new Map(); // requester index (0 = not an instance) -> { requests, bytes, feedRequests, feedBytes }
  const originStatuses = {};

  function originFetch(method, path, headers, body) {
    if (!originPorts.length) return Promise.resolve({ status: 502, headers: { "content-type": "text/plain" }, body: Buffer.from("No origin (serve-only)") });
    const port = originPorts[roundRobin++ % originPorts.length];
    return new Promise((resolveFetch) => {
      const outgoing = { ...headers, host: `127.0.0.1:${port}` };
      for (const name of Object.keys(outgoing)) if (HOP_BY_HOP.has(name.toLowerCase())) delete outgoing[name];
      const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: outgoing, timeout: 60_000 }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolveFetch({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", (error) => resolveFetch({ status: 502, headers: {}, body: Buffer.from(String(error)) }));
      });
      req.on("timeout", () => req.destroy(new Error("origin timeout")));
      req.on("error", (error) => resolveFetch({ status: 502, headers: { "content-type": "text/plain" }, body: Buffer.from(`Origin error: ${error.message}`) }));
      if (body?.length) req.end(body);
      else req.end();
    });
  }

  function cacheable(result) {
    if (result.status !== 200 || result.headers["set-cookie"]) return null;
    const cc = parseCacheControl(result.headers["cache-control"]);
    if (cc.private || cc["no-store"] || cc["no-cache"]) return null;
    const fresh = Number.isFinite(cc["s-maxage"]) ? cc["s-maxage"] : Number.isFinite(cc["max-age"]) ? cc["max-age"] : 0;
    if (!(fresh > 0)) return null;
    const swr = Number.isFinite(cc["stale-while-revalidate"]) ? cc["stale-while-revalidate"] : 0;
    return { freshMs: fresh * 1000, swrMs: swr * 1000 };
  }

  /** Fetch from an instance; store when cacheable. Conditional on the stored ETag when there is one. */
  async function fill(key, path, headers, previous, counters) {
    const outgoing = { ...headers };
    delete outgoing["if-none-match"];
    delete outgoing["if-modified-since"];
    if (previous?.etag) outgoing["if-none-match"] = previous.etag;
    for (const c of counters) c.originRequests += 1;
    const result = await originFetch("GET", path, outgoing);
    originStatuses[result.status] = (originStatuses[result.status] ?? 0) + 1;
    for (const c of counters) c.originBytes += result.body.length;
    if (result.status === 304 && previous) {
      for (const c of counters) c.originNotModified += 1;
      const lifetime = cacheable({ ...result, status: 200, headers: { ...previous.headers, ...result.headers } }) ?? previous;
      const refreshed = { ...previous, storedAt: Date.now(), freshMs: lifetime.freshMs, swrMs: lifetime.swrMs };
      cache.set(key, refreshed);
      return refreshed;
    }
    const lifetime = cacheable(result);
    const entry = { status: result.status, headers: result.headers, body: result.body, storedAt: Date.now(), etag: result.headers.etag ?? null, ...(lifetime ?? { freshMs: 0, swrMs: 0 }) };
    if (lifetime) cache.set(key, entry);
    return entry;
  }

  function send(req, res, entry, label, counters) {
    const headers = {};
    for (const [name, value] of Object.entries(entry.headers)) if (!HOP_BY_HOP.has(name) && name !== "content-length") headers[name] = value;
    headers["x-cache"] = label;
    if (entry.freshMs) headers.age = String(Math.floor((Date.now() - entry.storedAt) / 1000));
    const inm = req.headers["if-none-match"];
    if (entry.status === 200 && entry.etag && inm && inm.split(",").some((tag) => tag.trim().replace(/^W\//, "") === entry.etag.replace(/^W\//, ""))) {
      for (const c of counters) c.notModifiedToClient += 1;
      res.writeHead(304, headers);
      res.end();
      return 0;
    }
    headers["content-length"] = entry.body.length;
    res.writeHead(entry.status, headers);
    res.end(req.method === "HEAD" ? undefined : entry.body);
    for (const c of counters) c.clientBytes += entry.body.length;
    return entry.body.length;
  }

  function handler(requester) {
    return async (req, res) => {
      const path = req.url;
      const parsed = new URL(path, "http://cdn");
      // Per-path rows keep the operation apart (/api/tarkov?op=price.feed vs other ops).
      const op = parsed.searchParams.get("op");
      const pathname = op ? `${parsed.pathname}?op=${op}` : parsed.pathname;
      const isFeed = feedPattern.test(path);
      if (!perPath.has(pathname)) perPath.set(pathname, blank());
      const counters = [totals, perPath.get(pathname), ...(isFeed ? [feed] : [])];
      for (const c of counters) c.requests += 1;
      if (!perRequester.has(requester)) perRequester.set(requester, { requests: 0, bytes: 0, feedRequests: 0, feedBytes: 0, feed200: 0, feed304: 0, feedFailed: 0 });
      const who = perRequester.get(requester);
      who.requests += 1;
      if (isFeed) who.feedRequests += 1;
      const account = (bytes, status) => {
        who.bytes += bytes;
        if (isFeed) {
          who.feedBytes += bytes;
          if (status === 200) who.feed200 += 1;
          else if (status === 304) who.feed304 += 1;
          else who.feedFailed += 1;
        }
      };

      if (isFeed && config.inject.feedDown) {
        for (const c of counters) c.feedDown += 1;
        const body = "Bad gateway (CDN stand-in, --feed-down)";
        res.writeHead(502, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body), "x-cache": "ERROR" });
        res.end(body);
        account(0, 502);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        for (const c of counters) c.pass += 1;
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const result = await originFetch(req.method, path, req.headers, Buffer.concat(chunks));
        const bytes = send(req, res, { ...result, freshMs: 0, etag: null }, "PASS", counters);
        account(bytes, result.status);
        return;
      }

      const key = `${path}|${encodingBucket(req.headers["accept-encoding"])}`;
      const entry = cache.get(key);
      const age = entry ? Date.now() - entry.storedAt : Infinity;
      let served;
      let label;
      if (entry && age < entry.freshMs) {
        for (const c of counters) c.hit += 1;
        served = entry;
        label = "HIT";
      } else if (entry && age < entry.freshMs + entry.swrMs) {
        for (const c of counters) c.stale += 1;
        served = entry;
        label = "STALE";
        if (!revalidating.has(key)) {
          revalidating.add(key);
          for (const c of counters) c.revalidations += 1;
          fill(key, path, req.headers, entry, counters).finally(() => revalidating.delete(key));
        }
      } else {
        let pending = misses.get(key);
        const follower = Boolean(pending);
        if (!follower) {
          for (const c of counters) c.miss += 1;
          pending = fill(key, path, req.headers, entry, counters).finally(() => misses.delete(key));
          misses.set(key, pending);
        }
        served = await pending;
        const ok = served.status === 200 || served.status === 304;
        // A follower of a miss counts as served from cache only when the shared origin fetch worked.
        for (const c of counters) {
          if (!ok) c.failed += 1;
          else if (follower) c.coalesced += 1;
        }
        label = follower ? "HIT-COALESCED" : "MISS";
      }
      const bytes = send(req, res, served, label, counters);
      account(bytes, bytes === 0 && served.status === 200 ? 304 : served.status);
    };
  }

  const servers = [];
  for (let k = 0; k <= instanceCount; k += 1) {
    const server = createServer(handler(k));
    server.keepAliveTimeout = 5_000;
    const port = config.cdnPort ? config.cdnPort + k : 0;
    await new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));
    servers.push(server);
  }
  const origins = servers.map((server) => `http://127.0.0.1:${server.address().port}`);
  return {
    /** origins[0] is the public face; origins[k] is what instance k uses. */
    origins,
    setOriginPorts(ports) {
      originPorts.splice(0, originPorts.length, ...ports);
    },
    report() {
      const servedFromCache = (c) => c.hit + c.stale + c.coalesced;
      const cacheableRequests = (c) => servedFromCache(c) + c.miss;
      const ratio = (c) => (cacheableRequests(c) ? round((servedFromCache(c) / cacheableRequests(c)) * 100, 1) : null);
      return {
        origins,
        feedPath: config.feedPath,
        feedDown: config.inject.feedDown,
        totals: { ...totals, hitPct: ratio(totals) },
        feed: { ...feed, hitPct: ratio(feed) },
        perPath: Object.fromEntries([...perPath].map(([path, c]) => [path, { ...c, hitPct: ratio(c) }])),
        perRequester: Object.fromEntries([...perRequester].sort((a, b) => a[0] - b[0]).map(([k, c]) => [k === 0 ? "public" : `instance ${k}`, c])),
        originStatuses,
      };
    },
    async close() {
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolveClose) => server.close(resolveClose));
      }
    },
  };
}

// ---------- fake AuthKit issuer ----------

async function startIssuer(resourceUrl) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "load-test", alg: "RS256", use: "sig" };
  let jwksRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/oauth2/jwks") {
      jwksRequests += 1;
      const body = JSON.stringify({ keys: [jwk] });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolveListen) => server.listen(config.issuerPort, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tokens = new Map();
  return {
    origin,
    jwksRequests: () => jwksRequests,
    async token(sub) {
      const cached = tokens.get(sub);
      const now = Math.floor(Date.now() / 1000);
      if (cached && cached.exp - now > 30) return cached.token;
      const exp = now + config.tokenTtlS;
      const token = await new SignJWT({ sid: `session_${sub}` })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT" })
        .setIssuer(origin)
        .setAudience(resourceUrl)
        .setSubject(sub)
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .sign(privateKey);
      tokens.set(sub, { token, exp });
      return token;
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

// ---------- the app ----------

function descendants(rootPid) {
  const children = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(name));
    } catch {
      // The process exited.
    }
  }
  const all = [rootPid];
  for (let i = 0; i < all.length; i += 1) all.push(...(children.get(all[i]) ?? []));
  return all;
}

function rssKb(pid) {
  try {
    const match = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function instanceLogPath(index) {
  if (!config.serverLog) return join(mkdtempSync(join(tmpdir(), "mcp-load-")), "server.log");
  if (config.instances === 1) return config.serverLog;
  return `${config.serverLog.replace(/\.log$/, "")}.${index}.log`;
}

/** index is 1-based. */
function startApp(index, { upstreamOrigin, issuerOrigin, resourceUrl, feedOrigin }) {
  const dir = resolve(config.start);
  if (index === 1) {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      if (existsSync(join(dir, name))) console.warn(`Note: ${name} exists in ${dir}; the vars this script sets still win.`);
    }
  }
  const port = config.port + index - 1;
  const env = { ...process.env };
  for (const name of ["WARM_TARKOV_CACHE", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NODE_ENV"]) delete env[name];
  Object.assign(env, {
    TARKOV_UPSTREAM_URL: `${upstreamOrigin}/i${index}`,
    PRICE_FEED_ORIGIN: feedOrigin,
    MCP_AUTHKIT_DOMAIN: config.auth ? issuerOrigin : "",
    MCP_RESOURCE_URL: resourceUrl,
    // Empty, not unset, so .env files can't fill them in.
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    KV_REST_API_URL: "",
    KV_REST_API_TOKEN: "",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  const logPath = instanceLogPath(index);
  const log = createWriteStream(logPath);
  const child = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: dir,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = [];
  let partial = "";
  const onData = (chunk) => {
    log.write(chunk);
    partial += chunk.toString("utf8");
    const parts = partial.split("\n");
    partial = parts.pop();
    lines.push(...parts);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const rss = { samples: 0, peakKb: 0, peakSingleKb: 0, finalKb: 0, series: [] };
  const startedAt = Date.now();
  const sample = () => {
    if (exited) return;
    const pids = descendants(child.pid);
    const sizes = pids.map(rssKb);
    const total = sizes.reduce((sum, kb) => sum + kb, 0);
    if (total === 0) return;
    rss.samples += 1;
    rss.peakKb = Math.max(rss.peakKb, total);
    rss.peakSingleKb = Math.max(rss.peakSingleKb, ...sizes);
    rss.finalKb = total;
    rss.series.push([Date.now() - startedAt, total]);
  };
  const sampler = setInterval(sample, 500);

  return {
    index,
    port,
    url: `http://127.0.0.1:${port}/api/mcp`,
    startedAt,
    logPath,
    lines,
    rss,
    exited: () => exited,
    async stop() {
      sample();
      clearInterval(sampler);
      if (!exited) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
        const deadline = Date.now() + 5_000;
        while (!exited && Date.now() < deadline) await sleep(100);
        if (!exited) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }
      if (!log.closed) await new Promise((resolveEnd) => log.end(resolveEnd));
    },
  };
}

async function waitForApp(url, app) {
  const deadline = Date.now() + config.readyTimeoutMs;
  while (Date.now() < deadline) {
    if (app?.exited()) throw new Error(`The app exited during start: ${JSON.stringify(app.exited())}`);
    try {
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(2_000) });
      await response.body?.cancel();
      return Date.now();
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`The app did not answer at ${url} within ${config.readyTimeoutMs} ms`);
}

// ---------- the load ----------

class Pacer {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.updatedAt = Date.now();
    this.queue = Promise.resolve();
  }
  take(cost) {
    const turn = this.queue.then(async () => {
      for (;;) {
        const now = Date.now();
        this.tokens = Math.min(this.burst, this.tokens + ((now - this.updatedAt) / 1000) * this.rate);
        this.updatedAt = now;
        if (this.tokens >= cost) {
          this.tokens -= cost;
          return;
        }
        await sleep(Math.ceil(((cost - this.tokens) / this.rate) * 1000));
      }
    });
    this.queue = turn;
    return turn;
  }
}

class Gate {
  constructor(size) {
    this.free = size;
    this.waiting = [];
  }
  async acquire() {
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise((resolveTurn) => this.waiting.push(resolveTurn));
  }
  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * targets: [{ index, url, ready: Promise }] (1-based index). Agent a goes to targets[a % n]. Without
 * --eager every agent waits for all targets; with it, each agent waits only for its own.
 */
async function runLoad(targets, issuer, loadAnchor) {
  const lanes = targets.map((target) => ({ ...target, pacer: new Pacer(config.rate, config.rateBurst), gate: new Gate(config.maxInflight) }));
  const records = [];
  let rpcId = 0;

  async function post(lane, sub, message, cost) {
    const attempts = [];
    for (let attempt = 0; ; attempt += 1) {
      await lane.pacer.take(cost);
      await lane.gate.acquire();
      const headers = {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "User-Agent": "mcp-load/1.0",
      };
      if (config.auth) headers.Authorization = `Bearer ${await issuer.token(sub)}`;
      const startedAt = performance.now();
      let outcome;
      try {
        const response = await fetch(lane.url, {
          method: "POST",
          headers,
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        const text = await response.text();
        outcome = { status: response.status, text, contentType: response.headers.get("content-type") ?? "", retryAfter: response.headers.get("retry-after") };
      } catch (error) {
        outcome = { status: 0, text: "", error: error?.name === "TimeoutError" ? `client timeout after ${config.timeoutMs} ms` : String(error?.cause?.code ?? error?.message ?? error) };
      } finally {
        lane.gate.release();
      }
      outcome.ms = performance.now() - startedAt;
      attempts.push(outcome);
      if (outcome.status === 429 && attempt < config.retries) {
        await sleep(Math.max(1, Number(outcome.retryAfter) || 1) * 1000);
        continue;
      }
      return attempts;
    }
  }

  function parseBody(outcome) {
    if (!outcome.text) return null;
    try {
      if (outcome.contentType.includes("text/event-stream")) {
        const data = outcome.text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).at(-1);
        return data ? JSON.parse(data) : null;
      }
      return JSON.parse(outcome.text);
    } catch {
      return null;
    }
  }

  async function call(lane, sub, tool, args) {
    const isHandshake = tool === "(initialize)";
    const message = isHandshake
      ? {
          jsonrpc: "2.0",
          id: ++rpcId,
          method: "initialize",
          params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "mcp-load", version: "1.0" } },
        }
      : { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } };
    const issuedAt = Date.now();
    const attempts = await post(lane, sub, message, isHandshake ? 0.25 : (TOOL_COSTS[tool] ?? 1));
    const last = attempts.at(-1);
    const record = {
      tool,
      instance: lane.index,
      t: issuedAt - loadAnchor,
      endedAt: Date.now(),
      ms: last.ms,
      status: last.status,
      http429: attempts.filter((a) => a.status === 429).length,
      kind: "ok",
      text: null,
      dataNotice: false,
    };
    if (last.status === 0) {
      record.kind = "network";
      record.text = last.error;
    } else if (last.status === 429) {
      record.kind = "http429";
      record.text = `HTTP 429: ${parseBody(last)?.error?.message ?? last.text.slice(0, 120)}`;
    } else if (last.status < 200 || last.status >= 300) {
      record.kind = "http";
      record.text = `HTTP ${last.status}: ${parseBody(last)?.error?.message ?? last.text.slice(0, 120)}`;
    } else {
      const body = parseBody(last);
      if (!body) {
        record.kind = "http";
        record.text = `HTTP ${last.status}: unreadable body`;
      } else if (body.error) {
        record.kind = "rpc";
        record.text = `JSON-RPC ${body.error.code}: ${String(body.error.message).slice(0, 200)}`;
      } else if (body.result?.isError) {
        record.kind = "tool";
        record.text = String(body.result.content?.[0]?.text ?? "(no text)").slice(0, 200);
      } else if (!isHandshake) {
        const structured = body.result?.structuredContent;
        record.dataNotice = Boolean(structured?.dataNotice ?? /"dataNotice"/.test(body.result?.content?.[0]?.text ?? ""));
      }
    }
    records.push(record);
    return record;
  }

  async function notifyInitialized(lane, sub) {
    await post(lane, sub, { jsonrpc: "2.0", method: "notifications/initialized" }, 0.25);
  }

  const allReady = Promise.all(lanes.map((lane) => lane.ready));
  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: config.agents }, async (_, index) => {
      const lane = lanes[index % lanes.length];
      const sub = `user_load_${String(index + 1).padStart(3, "0")}`;
      await (config.eager ? lane.ready : allReady);
      // Stagger agents across the first second.
      await sleep(Math.random() * 1000);
      if (config.handshake) {
        await call(lane, sub, "(initialize)");
        await notifyInitialized(lane, sub);
      }
      let remaining = config.calls;
      while (remaining > 0) {
        const size = Math.min(remaining, config.burst[0] + Math.floor(Math.random() * (config.burst[1] - config.burst[0] + 1)));
        remaining -= size;
        await Promise.all(
          Array.from({ length: size }, () => {
            const tool = pickTool();
            return call(lane, sub, tool, WORKLOADS[tool]());
          })
        );
        if (remaining > 0) await sleep(config.think[0] + Math.random() * (config.think[1] - config.think[0]));
      }
    })
  );
  return { records, durationMs: Date.now() - startedAt };
}

// ---------- report ----------

function summarize(records) {
  const tools = new Map();
  for (const record of records) {
    if (!tools.has(record.tool)) tools.set(record.tool, []);
    tools.get(record.tool).push(record);
  }
  const perTool = Object.fromEntries([...tools].sort().map(([name, list]) => [name, callRow(list)]));
  const toolCalls = records.filter((r) => r.tool !== "(initialize)");
  const errors = new Map();
  for (const record of records) {
    if (!record.text) continue;
    errors.set(record.text, (errors.get(record.text) ?? 0) + 1);
  }
  return {
    perTool,
    overall: callRow(toolCalls),
    errorTexts: [...errors].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ count, text })),
  };
}

function callRow(list) {
  const latencies = list.map((r) => r.ms).sort((a, b) => a - b);
  const count = list.length;
  const by = (kind) => list.filter((r) => r.kind === kind).length;
  const toolErrors = by("tool") + by("rpc");
  const httpErrors = by("http") + by("network");
  const http429 = by("http429");
  return {
    count,
    ok: by("ok"),
    p50Ms: Math.round(percentile(latencies, 50) ?? 0),
    p95Ms: Math.round(percentile(latencies, 95) ?? 0),
    maxMs: Math.round(latencies.at(-1) ?? 0),
    toolErrors,
    httpErrors,
    http429Final: http429,
    http429Responses: list.reduce((sum, r) => sum + r.http429, 0),
    errorRate: count ? (toolErrors + httpErrors + http429) / count : 0,
    dataNotice: list.filter((r) => r.dataNotice).length,
  };
}

function timelineBuckets(records, bucketMs = 5_000) {
  const buckets = new Map();
  for (const record of records) {
    if (record.tool === "(initialize)") continue;
    const at = Math.floor(record.t / bucketMs) * bucketMs;
    if (!buckets.has(at)) buckets.set(at, { fromS: at / 1000, calls: 0, ok: 0, okStale: 0, toolError: 0, httpError: 0, http429: 0, p50Ms: 0 });
    const bucket = buckets.get(at);
    bucket.calls += 1;
    if (record.kind === "ok") bucket.ok += 1;
    if (record.kind === "ok" && record.dataNotice) bucket.okStale += 1;
    if (record.kind === "tool" || record.kind === "rpc") bucket.toolError += 1;
    if (record.kind === "http" || record.kind === "network") bucket.httpError += 1;
    if (record.kind === "http429") bucket.http429 += 1;
  }
  for (const [at, bucket] of buckets) {
    const latencies = records.filter((r) => r.tool !== "(initialize)" && Math.floor(r.t / bucketMs) * bucketMs === at).map((r) => r.ms).sort((a, b) => a - b);
    bucket.p50Ms = Math.round(percentile(latencies, 50) ?? 0);
  }
  return [...buckets.values()].sort((a, b) => a.fromS - b.fromS);
}

const plainCounters = (entry, anchor) => ({
  requests: entry.requests,
  ok200: entry.ok200,
  notModified: entry.notModified,
  failures: entry.failures,
  hung: entry.hung,
  wireBytes: entry.wireBytes,
  firstOkAtS: entry.firstOkAt === null ? null : round((entry.firstOkAt - anchor) / 1000, 1),
});

function upstreamReport(upstream, anchor, endedAt) {
  const perResource = {};
  const totals = { requests: 0, ok200: 0, notModified: 0, failures: 0, hung: 0, wireBytes: 0 };
  // Bulk = the items file (<mode>/items); other = every other dataset (items_en included).
  const split = { bulkItems: { ...totals }, other: { ...totals } };
  for (const mode of MODES) {
    for (const resource of RESOURCES) {
      const key = `${mode}/${resource}`;
      const entry = upstream.stats.get(key);
      if (!entry) continue;
      perResource[key] = plainCounters(entry, anchor);
      for (const field of Object.keys(totals)) {
        totals[field] += entry[field];
        split[resource === "items" ? "bulkItems" : "other"][field] += entry[field];
      }
    }
  }
  const unknown = upstream.stats.get("(unknown)");
  if (unknown) perResource["(unknown path)"] = { requests: unknown.requests };
  const perInstance = Object.fromEntries(
    [...upstream.perInstance].sort((a, b) => a[0] - b[0]).map(([instance, entry]) => [
      instance === 0 ? "unprefixed" : `instance ${instance}`,
      { bulkItems: plainCounters(entry.bulk, anchor), other: plainCounters(entry.other, anchor) },
    ])
  );
  const windowS = Math.max(1, (endedAt - anchor) / 1000);
  // Steady state: requests after each resource's first good copy, so the cold fetches don't dominate.
  const firstOk = new Map([...upstream.stats].filter(([, e]) => e.firstOkAt !== null).map(([k, e]) => [k, e.firstOkAt]));
  const steady = upstream.timeline.filter((event) => firstOk.has(event.key) && event.t > firstOk.get(event.key));
  const steadyFrom = firstOk.size ? Math.max(...firstOk.values()) : endedAt;
  const steadyWindowS = Math.max(1, (endedAt - steadyFrom) / 1000);
  const steadyAfterAll = upstream.timeline.filter((event) => event.t > steadyFrom);
  return {
    perResource,
    totals,
    split,
    perInstance,
    windowS: round(windowS, 1),
    projection: {
      requestsPerHourRaw: Math.round((totals.requests / windowS) * 3600),
      wireMBPerHourRaw: round((totals.wireBytes / windowS / 1e6) * 3600, 1),
      requestsAfterFirstCopy: steady.length,
      steadyWindowS: round(steadyWindowS, 1),
      requestsPerHourSteady: Math.round((steadyAfterAll.length / steadyWindowS) * 3600),
      wireMBPerHourSteady: round((steadyAfterAll.reduce((sum, e) => sum + e.bytes, 0) / steadyWindowS / 1e6) * 3600, 1),
    },
    acceptEncoding: Object.fromEntries(upstream.acceptEncodings),
  };
}

function serverLogSummary(lines) {
  const outcomes = {};
  let staleCalls = 0;
  let cachedCalls = 0;
  const warnings = new Map();
  for (const line of lines) {
    if (line.includes('"event":"mcp_tool_call"')) {
      try {
        const entry = JSON.parse(line.slice(line.indexOf("{")));
        outcomes[entry.outcome] = (outcomes[entry.outcome] ?? 0) + 1;
        if (entry.stale) staleCalls += 1;
        if (entry.cached) cachedCalls += 1;
      } catch {
        // Not JSON after all.
      }
    } else if (/stale|failed|error|warn/i.test(line)) {
      const text = line.trim().replace(/\d{2,}/g, "#").slice(0, 160);
      warnings.set(text, (warnings.get(text) ?? 0) + 1);
    }
  }
  return {
    toolCallOutcomes: outcomes,
    staleCalls,
    cachedCalls,
    notableLines: [...warnings].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([text, count]) => ({ count, text })),
  };
}

function instanceReport(app, readyAt, records, upstream, cdn) {
  const mine = records.filter((r) => r.instance === app.index && r.tool !== "(initialize)");
  const firstOk = mine.filter((r) => r.kind === "ok").sort((a, b) => a.endedAt - b.endedAt)[0];
  const firstCall = [...mine].sort((a, b) => a.t - b.t)[0];
  const up = upstream.perInstance[`instance ${app.index}`] ?? null;
  const feed = cdn?.perRequester?.[`instance ${app.index}`] ?? null;
  return {
    index: app.index,
    port: app.port,
    readyAfterS: readyAt ? round((readyAt - app.startedAt) / 1000, 1) : null,
    firstAnswerAfterS: firstOk ? round((firstOk.endedAt - app.startedAt) / 1000, 1) : null,
    firstCallMs: firstCall ? Math.round(firstCall.ms) : null,
    calls: callRow(mine),
    upstream: up,
    upstreamBytes: up ? up.bulkItems.wireBytes + up.other.wireBytes : 0,
    cdnRequests: feed,
    logPath: app.logPath,
    rss: {
      peakMB: round(app.rss.peakKb / 1024),
      finalMB: round(app.rss.finalKb / 1024),
      peakSingleMB: round(app.rss.peakSingleKb / 1024),
      samples: app.rss.samples,
    },
    log: serverLogSummary(app.lines),
  };
}

function buildSummary(report) {
  const o = report.calls.overall;
  const s = report.upstream.split;
  const feed = report.cdn?.feed;
  const MB = (bytes) => round(bytes / 1e6, 3);
  return {
    scenario: report.config.scenario,
    instances: report.config.instances,
    calls: o.count,
    ok: o.ok,
    errorPct: round(o.errorRate * 100, 2),
    p50Ms: o.p50Ms,
    p95Ms: o.p95Ms,
    maxMs: o.maxMs,
    dataNotice: o.dataNotice,
    upstream: {
      requests: report.upstream.totals.requests,
      wireMB: MB(report.upstream.totals.wireBytes),
      bulkItems: { requests: s.bulkItems.requests, ok200: s.bulkItems.ok200, notModified: s.bulkItems.notModified, failures: s.bulkItems.failures, wireMB: MB(s.bulkItems.wireBytes) },
      other: { requests: s.other.requests, ok200: s.other.ok200, notModified: s.other.notModified, failures: s.other.failures, wireMB: MB(s.other.wireBytes) },
    },
    feed: feed
      ? {
          requests: feed.requests,
          servedFromCache: feed.hit + feed.stale + feed.coalesced,
          hit: feed.hit,
          stale: feed.stale,
          coalesced: feed.coalesced,
          miss: feed.miss,
          originRequests: feed.originRequests,
          originNotModified: feed.originNotModified,
          originMB: MB(feed.originBytes),
          servedMB: MB(feed.clientBytes),
          feedDown: feed.feedDown,
          failed: feed.failed,
          hitPct: feed.hitPct,
        }
      : null,
    cdn: report.cdn ? { requests: report.cdn.totals.requests, hitPct: report.cdn.totals.hitPct, servedMB: MB(report.cdn.totals.clientBytes), originMB: MB(report.cdn.totals.originBytes) } : null,
    perInstance: (report.instances ?? []).map((i) => ({
      index: i.index,
      readyAfterS: i.readyAfterS,
      firstAnswerAfterS: i.firstAnswerAfterS,
      firstCallMs: i.firstCallMs,
      upstreamMB: MB(i.upstreamBytes),
      bulkMB: MB(i.upstream?.bulkItems.wireBytes ?? 0),
      feedMB: MB(i.cdnRequests?.feedBytes ?? 0),
      peakRssMB: i.rss.peakMB,
    })),
    peakRssMB: Math.max(0, ...(report.instances ?? []).map((i) => i.rss.peakMB)),
  };
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function table(rows, columns) {
  const widths = columns.map(([label, key]) => Math.max(label.length, ...rows.map((row) => String(row[key] ?? "").length)));
  const line = (cells) => cells.map((cell, i) => String(cell).padStart(widths[i])).join("  ");
  return [line(columns.map(([label]) => label)), line(widths.map((w) => "-".repeat(w))), ...rows.map((row) => line(columns.map(([, key]) => row[key] ?? "")))].join("\n");
}

function printReport(report) {
  const out = [];
  out.push(`\n=== MCP load: ${report.config.scenario} — ${report.config.agents} agents × ${report.config.calls} calls on ${report.config.instances} instance(s), load ${report.load.durationS}s ===`);
  for (const i of report.instances ?? []) {
    out.push(`instance ${i.index} (:${i.port}): ready ${i.readyAfterS}s, first answer ${i.firstAnswerAfterS}s after spawn (first call ${i.firstCallMs} ms), ${i.calls.count} calls p50 ${i.calls.p50Ms} / p95 ${i.calls.p95Ms} ms, upstream ${round(i.upstreamBytes / 1e6, 2)} MB, feed ${round((i.cdnRequests?.feedBytes ?? 0) / 1e6, 3)} MB (${i.cdnRequests?.feedRequests ?? 0} req), RSS peak ${i.rss.peakMB} MB`);
  }
  out.push("");
  const toolRows = Object.entries(report.calls.perTool).map(([tool, r]) => ({ tool, ...r, errorPct: `${round(r.errorRate * 100, 1)}%` }));
  toolRows.push({ tool: "OVERALL (tools)", ...report.calls.overall, errorPct: `${round(report.calls.overall.errorRate * 100, 1)}%` });
  out.push(table(toolRows, [
    ["tool", "tool"], ["count", "count"], ["ok", "ok"], ["p50 ms", "p50Ms"], ["p95 ms", "p95Ms"], ["max ms", "maxMs"],
    ["toolErr", "toolErrors"], ["httpErr", "httpErrors"], ["429 final", "http429Final"], ["429 seen", "http429Responses"],
    ["err %", "errorPct"], ["dataNotice", "dataNotice"],
  ]));
  out.push("\nTimeline (5 s buckets from load start):");
  out.push(table(report.calls.timeline, [
    ["from s", "fromS"], ["calls", "calls"], ["ok", "ok"], ["ok stale", "okStale"], ["toolErr", "toolError"], ["httpErr", "httpError"], ["429", "http429"], ["p50 ms", "p50Ms"],
  ]));
  if (report.calls.errorTexts.length) {
    out.push("\nError texts:");
    for (const { count, text } of report.calls.errorTexts) out.push(`  ${String(count).padStart(4)} × ${text}`);
  }
  out.push("\nUpstream (stand-in tarkov.dev):");
  const upRows = Object.entries(report.upstream.perResource).map(([key, r]) => ({ key, ...r, kB: round((r.wireBytes ?? 0) / 1000) }));
  upRows.push({ key: "bulk items", ...report.upstream.split.bulkItems, kB: round(report.upstream.split.bulkItems.wireBytes / 1000) });
  upRows.push({ key: "other datasets", ...report.upstream.split.other, kB: round(report.upstream.split.other.wireBytes / 1000) });
  upRows.push({ key: "TOTAL", ...report.upstream.totals, kB: round(report.upstream.totals.wireBytes / 1000) });
  out.push(table(upRows, [
    ["resource", "key"], ["req", "requests"], ["200", "ok200"], ["304", "notModified"], ["fail", "failures"], ["hung", "hung"], ["wire kB", "kB"], ["1st 200 s", "firstOkAtS"],
  ]));
  const p = report.upstream.projection;
  out.push(`projection: ${p.requestsPerHourRaw} req/h, ${p.wireMBPerHourRaw} MB/h over the ${report.upstream.windowS}s window (includes cold fetches); steady state after every first copy: ${p.requestsPerHourSteady} req/h, ${p.wireMBPerHourSteady} MB/h over ${p.steadyWindowS}s`);
  out.push(`accept-encoding seen: ${JSON.stringify(report.upstream.acceptEncoding)}`);
  if (report.cdn) {
    out.push(`\nCDN stand-in (feed path /${report.cdn.feedPath}/i${report.cdn.feedDown ? ", --feed-down" : ""}):`);
    const cdnRows = Object.entries(report.cdn.perPath).map(([path, c]) => ({ path, ...c, kB: round(c.clientBytes / 1000), originKB: round(c.originBytes / 1000) }));
    cdnRows.push({ path: "FEED", ...report.cdn.feed, kB: round(report.cdn.feed.clientBytes / 1000), originKB: round(report.cdn.feed.originBytes / 1000) });
    cdnRows.push({ path: "TOTAL", ...report.cdn.totals, kB: round(report.cdn.totals.clientBytes / 1000), originKB: round(report.cdn.totals.originBytes / 1000) });
    out.push(table(cdnRows, [
      ["path", "path"], ["req", "requests"], ["hit", "hit"], ["stale", "stale"], ["coalesced", "coalesced"], ["miss", "miss"], ["pass", "pass"], ["304 out", "notModifiedToClient"],
      ["502 inj", "feedDown"], ["failed", "failed"], ["origin req", "originRequests"], ["origin 304", "originNotModified"], ["served kB", "kB"], ["origin kB", "originKB"], ["hit %", "hitPct"],
    ]));
  }
  const s = report.summary;
  out.push(`\nsummary: p50 ${s.p50Ms} ms, p95 ${s.p95Ms} ms, errors ${s.errorPct}%, dataNotice ${s.dataNotice}; upstream ${s.upstream.requests} req (bulk items ${s.upstream.bulkItems.requests} req: ${s.upstream.bulkItems.ok200}×200 ${s.upstream.bulkItems.notModified}×304, ${s.upstream.bulkItems.wireMB} MB; other ${s.upstream.other.wireMB} MB); feed ${s.feed ? `${s.feed.requests} req, ${s.feed.servedFromCache} from cache, ${s.feed.originRequests} origin, ${s.feed.servedMB} MB served` : "n/a"}; peak RSS ${s.peakRssMB} MB/instance`);
  for (const i of report.instances ?? []) {
    out.push(`instance ${i.index} log ${i.logPath}: outcomes ${JSON.stringify(i.log.toolCallOutcomes)}, stale ${i.log.staleCalls}, cached ${i.log.cachedCalls}`);
    for (const { count, text } of i.log.notableLines) out.push(`  ${String(count).padStart(4)} × ${text}`);
  }
  if (report.issuer) out.push(`JWKS fetches: ${report.issuer.jwksRequests}`);
  console.log(out.join("\n"));
}

// ---------- main ----------

async function main() {
  const upstream = await startUpstream();
  console.error(`stand-in upstream ${upstream.origin} (brotli q${config.brQuality} precompressed in ${upstream.precompressMs} ms)`);
  const instanceCount = config.start ? config.instances : 0;
  const cdn = await startCdn(instanceCount);
  console.error(`CDN stand-in ${cdn.origins.join(", ")}`);
  const url = config.url ?? `http://127.0.0.1:${config.port}/api/mcp`;
  const issuer = await startIssuer(url);
  console.error(`fake AuthKit issuer ${issuer.origin}`);
  if (config.priceSet === "real200") console.error(`price set: ${REAL_PRICE_NAMES.length} real names, e.g. ${REAL_PRICE_NAMES.slice(0, 4).join(" | ")}`);
  if (flag("serve-only")) {
    console.log(`TARKOV_UPSTREAM_URL=${upstream.origin} MCP_AUTHKIT_DOMAIN=${issuer.origin} MCP_RESOURCE_URL=${url} PRICE_FEED_ORIGIN=${cdn.origins[0]}`);
    console.log(`token for user_load_001: ${await issuer.token("user_load_001")}`);
    process.on("SIGINT", async () => {
      console.log(JSON.stringify({ upstream: upstreamReport(upstream, downAnchor, Date.now()), cdn: cdn.report() }, null, 2));
      await upstream.close();
      await cdn.close();
      await issuer.close();
      process.exit(0);
    });
    return;
  }
  const apps = [];
  let report;
  try {
    let targets;
    if (config.start) {
      cdn.setOriginPorts(Array.from({ length: config.instances }, (_, k) => config.port + k));
      for (let k = 1; k <= config.instances; k += 1) {
        const app = startApp(k, { upstreamOrigin: upstream.origin, issuerOrigin: issuer.origin, resourceUrl: url, feedOrigin: cdn.origins[k] });
        apps.push(app);
        console.error(`started next ${k}/${config.instances} in ${resolve(config.start)} on :${app.port}; log ${app.logPath}`);
      }
      downAnchor = apps[0].startedAt;
      targets = apps.map((app) => ({ index: app.index, url: app.url, ready: waitForApp(app.url, app) }));
    } else {
      targets = [{ index: 1, url, ready: waitForApp(url, null) }];
    }
    const anchor = apps[0]?.startedAt ?? Date.now();
    const readyAts = [];
    targets.forEach((target, i) => target.ready.then((at) => (readyAts[i] = at), () => {}));
    let loadAnchor;
    if (config.eager) {
      // Cold: the load clock starts at spawn; each instance's agents begin once it answers.
      loadAnchor = anchor;
      loadStartedAt = Date.now();
      if (config.settleMs) console.warn("--settle is ignored with --eager");
      console.error(`running ${config.scenario} load; agents start as their instance answers`);
    } else {
      await Promise.all(targets.map((target) => target.ready));
      const readyAt = Math.max(...readyAts.filter(Boolean), Date.now() - 1);
      console.error(`app${targets.length > 1 ? "s" : ""} answering after ${round((readyAt - anchor) / 1000, 1)}s; running ${config.scenario} load`);
      if (config.settleMs) await sleep(config.settleMs);
      loadAnchor = Date.now();
      loadStartedAt = loadAnchor;
    }
    const { records, durationMs } = await runLoad(targets, issuer, loadAnchor);
    const endedAt = Date.now();
    for (const app of apps) await app.stop();
    const calls = summarize(records);
    calls.timeline = timelineBuckets(records);
    const upstreamSummary = upstreamReport(upstream, anchor, endedAt);
    const cdnSummary = config.start ? cdn.report() : null;
    report = {
      config: { ...config, mix: Object.fromEntries(config.mix.map((m) => [m.name, m.weight])), realPriceNames: REAL_PRICE_NAMES.length || undefined },
      load: { durationS: round(durationMs / 1000, 1) },
      calls,
      upstream: upstreamSummary,
      cdn: cdnSummary,
      issuer: config.auth ? { jwksRequests: issuer.jwksRequests() } : null,
      instances: apps.map((app, i) => instanceReport(app, readyAts[i], records, upstreamSummary, cdnSummary)),
    };
    // Back-compat with reports from before --instances: app = the first instance plus the tree's peak.
    if (apps.length) {
      const first = report.instances[0];
      report.app = {
        readyAfterS: first.readyAfterS,
        loadStartedAfterS: round((loadAnchor - anchor) / 1000, 1),
        logPath: first.logPath,
        rss: { ...first.rss, peakMB: Math.max(...report.instances.map((i) => i.rss.peakMB)) },
        log: first.log,
      };
    }
    report.summary = buildSummary(report);
  } finally {
    for (const app of apps) await app.stop();
    await upstream.close();
    await cdn.close();
    await issuer.close();
  }
  printReport(report);
  const json = JSON.stringify(report, null, 2);
  if (config.jsonOut) writeFileSync(config.jsonOut, json);
  console.log(`\nJSON report:\n${json}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
