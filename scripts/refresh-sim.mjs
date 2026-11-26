#!/usr/bin/env node
// Watches the refresher (src/app/lib/durable/data-refresh-do.ts) against a stand-in tarkov.dev whose
// publishing schedule this script controls, under `wrangler dev`, with its clocks sped up.
//
//   npm run build                       # once: the Worker bundle and the data snapshot it serves
//   node scripts/refresh-sim.mjs        # about 17 minutes at the default --scale 30
//
// The stand-in serves the build's snapshot (data/tarkov) with real validators, so instances' snapshot
// copies revalidate with a 304, and publishes a new items file per game mode on a schedule: every 10
// simulated minutes at :00:23 (PVE :00:43), then moved to :01:23, then drifting to a 10.5-minute
// period. Each new file changes the Graphics card's flea price, so a page can be watched updating
// (`--serve-only` keeps the stand-in and wrangler running for that). The driver sends concurrent
// bursts of uncached API reads (POST /api/tarkov) through each phase, then nothing for a simulated
// hour, and reports per simulated hour: tarkov.dev requests, KV writes and requests to the
// refresher, read from its `refresher_check` log lines, and how far behind tarkov.dev prices were.
//
// Options: --scale <n> (REFRESH_TIME_SCALE, default 30), --port <worker port, default 8787>,
// --upstream-port <default 8791>, --serve-only.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const SCALE = Number(option("scale", 30));
const PORT = Number(option("port", 8787));
const UPSTREAM_PORT = Number(option("upstream-port", 8791));
const SERVE_ONLY = args.includes("--serve-only");
const MINUTE = 60_000 / SCALE;
const HOUR = 60 * MINUTE;
const MODES = ["regular", "pve"];
const WATCHED_ITEM = "57347ca924597744596b4e71"; // Graphics card

// The stand-in tarkov.dev ---------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync("data/tarkov/manifest.json", "utf8"));
const datasets = new Map();
for (const key of Object.keys(manifest.resources)) {
  const [mode, resource] = key.split("/");
  if (resource === "items") continue;
  datasets.set(key, readFileSync(join("data/tarkov", mode, `${resource}.json.br`)));
}
const items = Object.fromEntries(
  MODES.map((mode) => [mode, JSON.parse(brotliDecompressSync(readFileSync(join("data/tarkov", mode, "items.json.br"))).toString())])
);
const basePrice = Object.fromEntries(MODES.map((mode) => [mode, items[mode].data.items[WATCHED_ITEM].lastLowPrice]));

const started = Date.now();
// Last-Modified has whole seconds, which sped-up clocks would make a large part of a cycle: the
// schedule keeps to whole real seconds (a simulated :00:30 for PVP and :01:00 for PVE at 30x).
const second = (ms) => Math.round(ms / 1000) * 1000;
const base = started - (started % 1000);
/** Each mode's schedule, in real milliseconds: changes at `phase + k * period`. */
const schedules = {
  regular: { phase: base + second(30_000 / SCALE), period: second(10 * MINUTE) },
  pve: { phase: base + second(60_000 / SCALE), period: second(10 * MINUTE) },
};
const published = Object.fromEntries(MODES.map((mode) => [mode, []]));
const bodies = new Map();
/** Every request the stand-in answered. */
const upstream = [];

function currentItems(mode, now = Date.now()) {
  const { phase, period } = schedules[mode];
  const k = Math.floor((now - phase) / period);
  const changedAt = phase + k * period;
  const list = published[mode];
  // A schedule change never un-publishes: the newest change stands until the next one.
  if (!list.length || changedAt > list[list.length - 1]) list.push(changedAt);
  const latest = list[list.length - 1];
  const version = list.length;
  const key = `${mode}:${version}`;
  if (!bodies.has(key)) {
    items[mode].data.items[WATCHED_ITEM].lastLowPrice = basePrice[mode] + version * 1_000;
    bodies.clear();
    bodies.set(key, JSON.stringify(items[mode]));
  }
  // Last-Modified has whole seconds, as tarkov.dev's.
  return { body: bodies.get(key), etag: `"items-${mode}-${version}"`, lastModified: new Date(Math.floor(latest / 1000) * 1000).toUTCString() };
}

const standIn = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const [, mode, resource] = url.pathname.split("/");
  const conditional = Boolean(request.headers["if-none-match"] || request.headers["if-modified-since"]);
  const answer = (status, headers, body) => {
    upstream.push({ at: Date.now(), path: url.pathname, status, conditional });
    response.writeHead(status, { Date: new Date().toUTCString(), ...headers });
    response.end(body);
  };
  if (!MODES.includes(mode)) return answer(404, {}, "not found");
  if (resource === "items") {
    const { body, etag, lastModified } = currentItems(mode);
    if (request.headers["if-none-match"] === etag) return answer(304, { ETag: etag, "Last-Modified": lastModified });
    return answer(200, { "Content-Type": "application/json", ETag: etag, "Last-Modified": lastModified }, body);
  }
  const record = manifest.resources[`${mode}/${resource}`];
  const body = datasets.get(`${mode}/${resource}`);
  if (!record || !body) return answer(404, {}, "not found");
  const headers = { ETag: record.etag, "Last-Modified": record.lastModified };
  if (request.headers["if-none-match"] === record.etag) return answer(304, headers);
  return answer(200, { ...headers, "Content-Type": "application/json", "Content-Encoding": "br" }, body);
});
await new Promise((resolve) => standIn.listen(UPSTREAM_PORT, "127.0.0.1", resolve));

// wrangler dev ---------------------------------------------------------------------------------------

const checks = [];
const state = await mkdtemp(join(tmpdir(), "refresh-sim-"));
const wrangler = spawn(
  "npx",
  [
    "wrangler", "dev", "--port", String(PORT), "--persist-to", state,
    "--var", `TARKOV_UPSTREAM_URL:http://127.0.0.1:${UPSTREAM_PORT}`,
    "--var", `REFRESH_TIME_SCALE:${SCALE}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let ready;
const isReady = new Promise((resolve) => (ready = resolve));
for (const stream of [wrangler.stdout, wrangler.stderr]) {
  let buffered = "";
  stream.on("data", (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) {
      if (line.includes("Ready on")) ready();
      const start = line.indexOf('{"event":"refresher_check"');
      if (start !== -1) {
        try {
          checks.push({ at: Date.now(), ...JSON.parse(line.slice(start)) });
        } catch {
          // A line cut short.
        }
      }
    }
  });
}
await isReady;
const origin = `http://127.0.0.1:${PORT}`;
console.log(`Stand-in tarkov.dev on :${UPSTREAM_PORT}, wrangler dev on ${origin}, clocks ${SCALE}x.`);
const stop = () => {
  wrangler.kill("SIGINT");
  standIn.close();
};
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

if (SERVE_ONLY) {
  console.log("Serving until interrupted. Watch the Graphics card at /item/graphics-card.");
  await new Promise(() => undefined);
}

// The driver -----------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Each request comes from its own client IP: the per-client limit would otherwise refuse the driver.
// The global limit (5 a second, in bursts of 300) still applies, so the driver stays under it.
let clients = 0;
const clientIp = () => {
  clients += 1;
  return `10.${(clients >> 16) & 255}.${(clients >> 8) & 255}.${clients & 255}`;
};
let refused = 0;
const post = (operation, variables) =>
  fetch(`${origin}/api/tarkov`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": clientIp() },
    body: JSON.stringify({ operation, variables }),
  }).then((response) => {
    if (response.status === 429) refused += 1;
    return response.text();
  });

const read = (gameMode, tick) =>
  tick % 20 === 0
    ? post("item.detail", { gameMode, name: "Graphics card" })
    : tick % 97 === 0 && gameMode === "regular"
      ? post("map.details", { gameMode, mapKey: "customs" })
      : post("item.group", { gameMode, names: ["Graphics card", "Physical Bitcoin"] });

/** The next time a burst should land: a simulated minute after tarkov.dev's next publish, when the refresher's check falls due. */
function nextBurstAt(mode, after) {
  const { phase, period } = schedules[mode];
  return phase + Math.ceil((after - phase - MINUTE) / period) * period + MINUTE + 300;
}

/**
 * A request per game mode every simulated 30 seconds, as a trickle of visitors would make them, and
 * 15 concurrent requests per mode just as each check falls due: the moment de-duplication matters.
 */
async function traffic(durationMs) {
  const until = Date.now() + durationMs;
  const bursts = Object.fromEntries(MODES.map((mode) => [mode, nextBurstAt(mode, Date.now())]));
  let tick = 0;
  let nextTick = Date.now();
  const pending = new Set();
  const track = (promise) => {
    const settled = promise.catch(() => undefined).finally(() => pending.delete(settled));
    pending.add(settled);
  };
  while (Date.now() < until) {
    const now = Date.now();
    if (now >= nextTick) {
      for (const mode of MODES) track(read(mode, tick));
      tick += 1;
      nextTick += 30_000 / SCALE;
    }
    for (const mode of MODES) {
      if (now < bursts[mode]) continue;
      for (let index = 0; index < 15; index += 1) track(read(mode, 1));
      bursts[mode] = nextBurstAt(mode, now + 1);
    }
    await sleep(50);
  }
  await Promise.all(pending);
}

const phases = [];
async function phase(name, durationMs, run) {
  const from = Date.now();
  await run(durationMs);
  phases.push({ name, from, to: Date.now() });
  console.log(`  ${name}: done`);
}

await phase("steady 10-minute cycle", 2 * HOUR, traffic);
for (const mode of MODES) schedules[mode].phase += second(MINUTE);
await phase("moved a minute later (:10 to :11)", 1.5 * HOUR, traffic);
for (const mode of MODES) {
  const now = Date.now();
  const { phase: anchor, period } = schedules[mode];
  schedules[mode] = { phase: anchor + Math.floor((now - anchor) / period) * period, period: second(10.5 * MINUTE) };
}
await phase("drifting, 10.5-minute period", 2 * HOUR, traffic);
await phase("no traffic", HOUR, (ms) => sleep(ms));
await phase("traffic again", HOUR, traffic);
await sleep(2_000);
stop();

// The report -----------------------------------------------------------------------------------------

const perHour = (count, from, to) => (count / ((to - from) / HOUR)).toFixed(1);
console.log(`\nPer simulated hour (both game modes; ${SCALE}x clocks):`);
console.log("phase | items 200 | items 304 | datasets 200 | datasets 304 | KV writes | refresher requests | prices behind tarkov.dev (sim s, max / median)");
for (const { name, from, to } of phases) {
  const inPhase = (entry) => entry.at >= from && entry.at < to;
  const requests = upstream.filter(inPhase);
  const isItems = (entry) => entry.path.endsWith("/items");
  const logged = checks.filter(inPhase);
  const lags = logged.filter((check) => check.lagSeconds !== undefined).map((check) => check.lagSeconds * SCALE).sort((a, b) => a - b);
  const lag = lags.length ? `${Math.max(...lags)} / ${lags[Math.floor(lags.length / 2)]}` : "-";
  console.log(
    [
      name,
      perHour(requests.filter((entry) => isItems(entry) && entry.status === 200).length, from, to),
      perHour(requests.filter((entry) => isItems(entry) && entry.status === 304).length, from, to),
      perHour(requests.filter((entry) => !isItems(entry) && entry.status === 200).length, from, to),
      perHour(requests.filter((entry) => !isItems(entry) && entry.status === 304).length, from, to),
      perHour(logged.filter((check) => check.wroteKv).length, from, to),
      perHour(logged.reduce((sum, check) => sum + check.calls, 0), from, to),
      lag,
    ].join(" | ")
  );
}

console.log(`${refused} requests refused by the rate limit.`);
// One download per new items file, however many requests were waiting on it.
for (const mode of MODES) {
  const downloads = upstream.filter((entry) => entry.path === `/${mode}/items` && entry.status === 200).length;
  console.log(`${mode}: ${published[mode].length} items files published, ${downloads} downloaded`);
}
const prices = checks.filter((check) => check.dataset === "prices" && check.gameMode === "regular");
console.log("\nregular price checks (sim minutes since start, outcome, lag in sim seconds):");
console.log(prices.map((check) => `${(((check.at - started) / MINUTE)).toFixed(1)} ${check.outcome}${check.lagSeconds !== undefined ? ` ${check.lagSeconds * SCALE}s` : ""}`).join("; "));
process.exit(0);
