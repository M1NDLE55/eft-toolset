// Load test for the MCP endpoint (/api/mcp) against a stand-in tarkov.dev and a fake AuthKit issuer.
//
// Usage (Node 24, no extra deps; build the app first with `npx next build`):
//
//   node scripts/mcp-load.mjs --upstream-dir <dir> --start <app dir> [options]
//   node scripts/mcp-load.mjs --upstream-dir <dir> --url http://127.0.0.1:3000/api/mcp \
//        --upstream-port 4100 --issuer-port 4101 [options]
//
// <dir> holds tarkov.dev's JSON as <mode>-<resource>.json (modes regular and pve). With --start the
// script runs `npx next start` in <app dir> with TARKOV_UPSTREAM_URL, MCP_AUTHKIT_DOMAIN and
// MCP_RESOURCE_URL pointing at its own servers, samples the server's RSS, and kills it at the end.
// With --url the app must already run with TARKOV_UPSTREAM_URL=http://127.0.0.1:<upstream-port>,
// MCP_AUTHKIT_DOMAIN=http://127.0.0.1:<issuer-port> and MCP_RESOURCE_URL=<url> (or pass --no-auth
// for a development server without sign-in).
//
//   --scenario <name>       healthy | cold-upstream-down | flaky | slow | hang (default healthy)
//   --agents <n>            simulated agents, each with its own token sub (default 12)
//   --calls <n>             tool calls per agent (default 10)
//   --burst <a-b>           calls an agent sends at once, like parallel tool calls (default 1-3)
//   --think <a-b>           ms an agent pauses between bursts (default 500-2500; cold-upstream-down 3000-7000)
//   --rate <tokens/s>       client-side pacing against the instance's global MCP budget (default 3.5)
//   --rate-burst <tokens>   pacing bucket size (default 200; the server's is 240)
//   --max-inflight <n>      requests in flight at once (default 6, the server's tool-call cap)
//   --retries <n>           retries of a 429 after its Retry-After (default 2)
//   --timeout <ms>          client timeout per request (default 65000; tools stop at 40 s)
//   --mix k=w,...           tool weights (default search_items=35,get_item=20,get_item_prices=20,
//                           get_weapon=10,evaluate_build=8,modify_build=7)
//   --no-handshake          skip initialize + notifications/initialized per agent
//   --port <n>              app port with --start (default 3100)
//   --upstream-port <n>     stand-in upstream port (default random)
//   --issuer-port <n>       fake AuthKit port (default random)
//   --token-ttl <s>         access token lifetime (default 300; re-minted before expiry)
//   --ready-timeout <ms>    wait for the app to answer (default 60000)
//   --settle <ms>           wait after the app answers before load starts (default 0)
//   --server-log <path>     app stdout/stderr with --start (default a temp file)
//   --json <path>           also write the report as JSON to this file
//   --serve-only            start only the stand-in upstream and the issuer, print the app's env and a
//                           token, and run until Ctrl-C (for starting the app by hand)
//   Upstream injection (override the scenario's settings):
//   --latency <ms>          fixed delay per upstream response    --jitter <ms>   extra random delay
//   --fail-rate <0..1>      share of upstream requests answered 502
//   --down-for <s>          upstream answers 502 for the first s seconds (from app start with --start)
//   --hang                  upstream never answers
//   --items-etag-every <s>  items gets a new ETag every s seconds (prices change ~5 min upstream)
//   --br-quality <0..11>    brotli quality for the precompressed bodies (default 5)
//
// Prints a table and the JSON report; exits 0 unless the harness itself failed.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, createWriteStream, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
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

const SCENARIOS = {
  healthy: {},
  "cold-upstream-down": { downForS: 20 },
  flaky: { failRate: 0.2, latencyMs: 300 },
  slow: { latencyMs: 8000 },
  hang: { hang: true },
};
const scenarioName = opt("scenario", "healthy");
const scenario = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`Unknown --scenario ${scenarioName}; use ${Object.keys(SCENARIOS).join(", ")}`);

const config = {
  scenario: scenarioName,
  upstreamDir: opt("upstream-dir", undefined),
  start: opt("start", undefined),
  url: opt("url", undefined),
  port: num("port", 3100),
  upstreamPort: num("upstream-port", 0),
  issuerPort: num("issuer-port", 0),
  agents: num("agents", 12),
  calls: num("calls", 10),
  burst: range("burst", [1, 3]),
  think: range("think", scenarioName === "cold-upstream-down" ? [3000, 7000] : [500, 2500]),
  rate: num("rate", 3.5),
  rateBurst: num("rate-burst", 200),
  maxInflight: num("max-inflight", 6),
  retries: num("retries", 2),
  timeoutMs: num("timeout", 65_000),
  handshake: !flag("no-handshake"),
  auth: !flag("no-auth"),
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
    hang: flag("hang") || Boolean(scenario.hang),
    itemsEtagEveryS: num("items-etag-every", 0),
  },
  mix: [], // parsed below, once the workloads exist
};
if (!config.upstreamDir) throw new Error("--upstream-dir is required");
if (!config.start && !config.url && !flag("serve-only")) throw new Error("Give --start <app dir> or --url <mcp url>");
if (config.scenario === "cold-upstream-down" && !config.start) {
  console.warn("cold-upstream-down only measures a cold start with --start; the down window starts now.");
}

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
  get_item_prices: () => ({ items: pickN(PRICE_ITEMS, 5, 20), gameMode: gameMode() }),
  get_weapon: () => ({ weapon: pick(WEAPONS), gameMode: gameMode() }),
  evaluate_build: () => ({ build: { weapon: pick(WEAPONS), preset: "default" }, gameMode: gameMode() }),
  modify_build: () => ({ build: { weapon: pick(WEAPONS) }, changes: [{ action: "fill_required" }], gameMode: gameMode() }),
};

config.mix = parseMix(opt("mix", "search_items=35,get_item=20,get_item_prices=20,get_weapon=10,evaluate_build=8,modify_build=7"));

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
let downAnchor = Date.now(); // reset to the app's start with --start

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
  const timeline = []; // { t, key, status, bytes }
  const acceptEncodings = new Map();
  const hung = new Set();
  const counter = (key) => {
    let entry = stats.get(key);
    if (!entry) {
      entry = { requests: 0, ok200: 0, notModified: 0, failures: 0, hung: 0, wireBytes: 0, firstOkAt: null };
      stats.set(key, entry);
    }
    return entry;
  };

  function etagFor(key, file) {
    const every = config.inject.itemsEtagEveryS;
    const generation = every > 0 && key.endsWith("/items") ? Math.floor((Date.now() - upstreamStartedAt) / (every * 1000)) : 0;
    return `W/"${file.hash}${generation ? `-${generation}` : ""}"`;
  }
  const upstreamStartedAt = Date.now();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://upstream");
    const [, mode, resource] = url.pathname.split("/");
    const key = `${mode}/${resource}`;
    const file = files.get(key);
    const entry = counter(file ? key : "(unknown)");
    entry.requests += 1;
    const accept = String(req.headers["accept-encoding"] ?? "");
    acceptEncodings.set(accept, (acceptEncodings.get(accept) ?? 0) + 1);
    const t = Date.now();
    const finish = (status, bytes) => timeline.push({ t, key, status, bytes });

    if (config.inject.hang) {
      entry.hung += 1;
      hung.add(res);
      res.on("close", () => hung.delete(res));
      finish("hang", 0);
      return;
    }
    const delay = config.inject.latencyMs + Math.random() * config.inject.jitterMs;
    if (delay > 0) await sleep(delay);
    if (res.destroyed) return;
    const down = (Date.now() - downAnchor) / 1000 < config.inject.downForS;
    if (!file || down || Math.random() < config.inject.failRate) {
      const status = file ? 502 : 404;
      if (file) entry.failures += 1;
      const body = file ? "Bad gateway (stand-in)" : "Not found";
      res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      entry.wireBytes += Buffer.byteLength(body);
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
      entry.notModified += 1;
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
    entry.ok200 += 1;
    entry.wireBytes += body.length;
    entry.firstOkAt ??= Date.now();
    finish(200, body.length);
  });
  server.keepAliveTimeout = 5_000;
  await new Promise((resolveListen) => server.listen(config.upstreamPort, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    precompressMs,
    stats,
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

function startApp(upstreamOrigin, issuerOrigin, resourceUrl) {
  const dir = resolve(config.start);
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(join(dir, name))) console.warn(`Note: ${name} exists in ${dir}; the vars this script sets still win.`);
  }
  const env = { ...process.env };
  for (const name of ["WARM_TARKOV_CACHE", "VERCEL", "VERCEL_ENV", "NODE_ENV"]) delete env[name];
  Object.assign(env, {
    TARKOV_UPSTREAM_URL: upstreamOrigin,
    MCP_AUTHKIT_DOMAIN: config.auth ? issuerOrigin : "",
    MCP_RESOURCE_URL: resourceUrl,
    // Empty, not unset, so .env files can't fill them in.
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    KV_REST_API_URL: "",
    KV_REST_API_TOKEN: "",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  const logPath = config.serverLog ?? join(mkdtempSync(join(tmpdir(), "mcp-load-")), "server.log");
  const log = createWriteStream(logPath);
  const child = spawn("npx", ["next", "start", "-p", String(config.port), "-H", "127.0.0.1"], {
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
    startedAt,
    logPath,
    lines,
    rss,
    exited: () => exited,
    async stop() {
      sample();
      clearInterval(sampler);
      if (exited) return;
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
      await new Promise((resolveEnd) => log.end(resolveEnd));
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
      return;
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

async function runLoad(url, issuer, loadAnchor) {
  const pacer = new Pacer(config.rate, config.rateBurst);
  const gate = new Gate(config.maxInflight);
  const records = [];
  let rpcId = 0;

  async function post(sub, message, cost) {
    const attempts = [];
    for (let attempt = 0; ; attempt += 1) {
      await pacer.take(cost);
      await gate.acquire();
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
        const response = await fetch(url, {
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
        gate.release();
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

  async function call(sub, tool, args) {
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
    const attempts = await post(sub, message, isHandshake ? 0.25 : (TOOL_COSTS[tool] ?? 1));
    const last = attempts.at(-1);
    const record = {
      tool,
      t: issuedAt - loadAnchor,
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

  async function notifyInitialized(sub) {
    await post(sub, { jsonrpc: "2.0", method: "notifications/initialized" }, 0.25);
  }

  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: config.agents }, async (_, index) => {
      const sub = `user_load_${String(index + 1).padStart(3, "0")}`;
      // Stagger agents across the first second.
      await sleep(Math.random() * 1000);
      if (config.handshake) {
        await call(sub, "(initialize)");
        await notifyInitialized(sub);
      }
      let remaining = config.calls;
      while (remaining > 0) {
        const size = Math.min(remaining, config.burst[0] + Math.floor(Math.random() * (config.burst[1] - config.burst[0] + 1)));
        remaining -= size;
        await Promise.all(
          Array.from({ length: size }, () => {
            const tool = pickTool();
            return call(sub, tool, WORKLOADS[tool]());
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
  const row = (list) => {
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
  };
  const perTool = Object.fromEntries([...tools].sort().map(([name, list]) => [name, row(list)]));
  const toolCalls = records.filter((r) => r.tool !== "(initialize)");
  const errors = new Map();
  for (const record of records) {
    if (!record.text) continue;
    errors.set(record.text, (errors.get(record.text) ?? 0) + 1);
  }
  return {
    perTool,
    overall: row(toolCalls),
    errorTexts: [...errors].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ count, text })),
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

function upstreamReport(upstream, anchor, endedAt) {
  const perResource = {};
  const totals = { requests: 0, ok200: 0, notModified: 0, failures: 0, hung: 0, wireBytes: 0 };
  for (const mode of MODES) {
    for (const resource of RESOURCES) {
      const key = `${mode}/${resource}`;
      const entry = upstream.stats.get(key);
      if (!entry) continue;
      perResource[key] = {
        requests: entry.requests,
        ok200: entry.ok200,
        notModified: entry.notModified,
        failures: entry.failures,
        hung: entry.hung,
        wireBytes: entry.wireBytes,
        firstOkAtS: entry.firstOkAt === null ? null : round((entry.firstOkAt - anchor) / 1000, 1),
      };
      for (const field of Object.keys(totals)) totals[field] += entry[field];
    }
  }
  const unknown = upstream.stats.get("(unknown)");
  if (unknown) perResource["(unknown path)"] = { requests: unknown.requests };
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
  out.push(`\n=== MCP load: ${report.config.scenario} — ${report.config.agents} agents × ${report.config.calls} calls, load ${report.load.durationS}s ===`);
  if (report.app) out.push(`app ready after ${report.app.readyAfterS}s (load started ${report.app.loadStartedAfterS}s after spawn)`);
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
  upRows.push({ key: "TOTAL", ...report.upstream.totals, kB: round(report.upstream.totals.wireBytes / 1000) });
  out.push(table(upRows, [
    ["resource", "key"], ["req", "requests"], ["200", "ok200"], ["304", "notModified"], ["fail", "failures"], ["hung", "hung"], ["wire kB", "kB"], ["1st 200 s", "firstOkAtS"],
  ]));
  const p = report.upstream.projection;
  out.push(`projection: ${p.requestsPerHourRaw} req/h, ${p.wireMBPerHourRaw} MB/h over the ${report.upstream.windowS}s window (includes cold fetches); steady state after every first copy: ${p.requestsPerHourSteady} req/h, ${p.wireMBPerHourSteady} MB/h over ${p.steadyWindowS}s`);
  out.push(`accept-encoding seen: ${JSON.stringify(report.upstream.acceptEncoding)}`);
  if (report.app) {
    const r = report.app.rss;
    out.push(`\nserver RSS (process tree): peak ${r.peakMB} MB, final ${r.finalMB} MB; largest single process peak ${r.peakSingleMB} MB (${r.samples} samples)`);
    out.push(`server log: ${report.app.logPath}`);
    out.push(`server-side tool outcomes: ${JSON.stringify(report.app.log.toolCallOutcomes)}, stale ${report.app.log.staleCalls}, cached ${report.app.log.cachedCalls}`);
    if (report.app.log.notableLines.length) {
      out.push("notable server log lines:");
      for (const { count, text } of report.app.log.notableLines) out.push(`  ${String(count).padStart(4)} × ${text}`);
    }
  }
  if (report.issuer) out.push(`JWKS fetches: ${report.issuer.jwksRequests}`);
  console.log(out.join("\n"));
}

// ---------- main ----------

async function main() {
  const upstream = await startUpstream();
  console.error(`stand-in upstream ${upstream.origin} (brotli q${config.brQuality} precompressed in ${upstream.precompressMs} ms)`);
  const url = config.url ?? `http://127.0.0.1:${config.port}/api/mcp`;
  const issuer = await startIssuer(url);
  console.error(`fake AuthKit issuer ${issuer.origin}`);
  if (flag("serve-only")) {
    console.log(`TARKOV_UPSTREAM_URL=${upstream.origin} MCP_AUTHKIT_DOMAIN=${issuer.origin} MCP_RESOURCE_URL=${url}`);
    console.log(`token for user_load_001: ${await issuer.token("user_load_001")}`);
    process.on("SIGINT", async () => {
      console.log(JSON.stringify(upstreamReport(upstream, downAnchor, Date.now()), null, 2));
      await upstream.close();
      await issuer.close();
      process.exit(0);
    });
    return;
  }
  let app = null;
  let report;
  try {
    if (config.start) {
      app = startApp(upstream.origin, issuer.origin, url);
      downAnchor = app.startedAt;
      console.error(`started next in ${resolve(config.start)} on :${config.port}; log ${app.logPath}`);
    }
    const anchor = app?.startedAt ?? Date.now();
    await waitForApp(url, app);
    const readyAt = Date.now();
    if (config.settleMs) await sleep(config.settleMs);
    const loadAnchor = Date.now();
    console.error(`app answering after ${round((readyAt - anchor) / 1000, 1)}s; running ${config.scenario} load`);
    const { records, durationMs } = await runLoad(url, issuer, loadAnchor);
    const endedAt = Date.now();
    if (app) await app.stop();
    const calls = summarize(records);
    calls.timeline = timelineBuckets(records);
    report = {
      config: { ...config, mix: Object.fromEntries(config.mix.map((m) => [m.name, m.weight])) },
      load: { durationS: round(durationMs / 1000, 1) },
      calls,
      upstream: upstreamReport(upstream, anchor, endedAt),
      issuer: config.auth ? { jwksRequests: issuer.jwksRequests() } : null,
      app: app
        ? {
            readyAfterS: round((readyAt - anchor) / 1000, 1),
            loadStartedAfterS: round((loadAnchor - anchor) / 1000, 1),
            logPath: app.logPath,
            rss: {
              peakMB: round(app.rss.peakKb / 1024),
              finalMB: round(app.rss.finalKb / 1024),
              peakSingleMB: round(app.rss.peakSingleKb / 1024),
              samples: app.rss.samples,
            },
            log: serverLogSummary(app.lines),
          }
        : null,
    };
  } finally {
    if (app) await app.stop();
    await upstream.close();
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
