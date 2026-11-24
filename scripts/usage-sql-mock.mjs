#!/usr/bin/env node
/**
 * A local stand-in for the Analytics Engine SQL API, for trying the usage stats with `wrangler dev`
 * (Analytics Engine can't be queried locally). It runs the given command, reads the anonymous rows
 * the Worker logs when USAGE_LOG_EVENTS=1 (`{"event":"usage_event",...}`), and answers the exact
 * queries src/app/lib/usage/stats.ts sends from those rows. It is not a SQL engine: anything else
 * gets a 400. Never used in production; sqlConfig() only accepts a localhost USAGE_SQL_API_URL.
 *
 *   node scripts/usage-sql-mock.mjs --port 8790 -- npx wrangler dev --config dist/server/wrangler.json \
 *     --var USAGE_LOG_EVENTS:1 --var USAGE_SQL_API_URL:http://127.0.0.1:8790/sql
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const options = split === -1 ? args : args.slice(0, split);
const command = split === -1 ? [] : args.slice(split + 1);
const port = Number(options[options.indexOf("--port") + 1]) || 8790;

/** @type {{ timestamp: number, blobs: string[], sample: number }[]} */
const rows = [];
const DAY = 86_400_000;

function ingest(line) {
  const start = line.indexOf('{"event":"usage_event"');
  if (start === -1) return;
  try {
    const point = JSON.parse(line.slice(start));
    rows.push({ timestamp: Date.now(), blobs: point.blobs, sample: 1 });
    console.log(`[usage-sql-mock] row ${rows.length}: ${point.blobs[0]} (${point.blobs[1]})`);
  } catch {
    // A line that only looked like a row.
  }
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (ms) => `${iso(ms)} 00:00:00`;
const weekOf = (ms) => {
  const start = Math.floor(ms / DAY) * DAY;
  return dayOf(start - ((new Date(start).getUTCDay() + 6) % 7) * DAY);
};
const b = (row, n) => row.blobs[n - 1] ?? "";

function filtered(query) {
  const now = Date.now();
  let from = -Infinity;
  let to = Infinity;
  const interval = /timestamp > NOW\(\) - INTERVAL '(\d+)' DAY/.exec(query);
  if (interval) from = now - Number(interval[1]) * DAY;
  const lower = /timestamp >= toDateTime\('([\d-]+) 00:00:00'\)/.exec(query);
  const upper = /timestamp < toDateTime\('([\d-]+) 00:00:00'\)/.exec(query);
  if (lower) from = Date.parse(`${lower[1]}T00:00:00Z`);
  if (upper) to = Date.parse(`${upper[1]}T00:00:00Z`);
  return rows.filter((row) => {
    if (row.timestamp < from || row.timestamp >= to) return false;
    if (query.includes("blob1 = 'mcp.tool_call'") && b(row, 1) !== "mcp.tool_call") return false;
    if (query.includes("(blob1 = 'page.view' OR blob1 = 'page.error')") && !["page.view", "page.error"].includes(b(row, 1))) return false;
    for (const column of [6, 10, 12, 13]) if (query.includes(`blob${column} != ''`) && b(row, column) === "") return false;
    return true;
  });
}

const isError = (row) => b(row, 8) !== "" && b(row, 8) !== "ok";

function group(list, keyOf, fields) {
  const groups = new Map();
  for (const row of list) {
    const key = keyOf(row);
    const id = JSON.stringify(key);
    const entry = groups.get(id) ?? { ...key, n: 0, errors: 0, ids: new Set() };
    entry.n += row.sample;
    if (isError(row)) entry.errors += row.sample;
    if (fields.distinct) entry.ids.add(b(row, fields.distinct));
    groups.set(id, entry);
  }
  return [...groups.values()].map(({ ids, errors, ...rest }) => ({
    ...rest,
    ...(fields.errors ? { errors } : {}),
    ...(fields.distinct ? { ids: ids.size } : {}),
  }));
}

const byCount = (list) => list.sort((x, y) => y.n - x.n);

function quantile(values, q) {
  const sorted = values.toSorted((x, y) => x - y);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0;
}

function answer(query) {
  const list = filtered(query);
  if (query.includes("quantileExactWeighted")) {
    const perId = group(list, (row) => ({ id: b(row, 12), signed_in: b(row, 14), day: dayOf(row.timestamp) }), {});
    for (const entry of perId) {
      entry.n = list.filter((row) => b(row, 12) === entry.id && dayOf(row.timestamp) === entry.day && b(row, 1) !== "page.view").length;
    }
    return ["0", "1"]
      .map((signed) => perId.filter((entry) => entry.signed_in === signed).map((entry) => entry.n))
      .map((values, index) => ({ signed_in: String(index), ids: values.length, p50: quantile(values, 0.5), p90: quantile(values, 0.9), max: Math.max(0, ...values) }))
      .filter((entry) => entry.ids > 0);
  }
  if (query.includes("GROUP BY day, event, source, feature")) {
    return group(list, (row) => ({ day: dayOf(row.timestamp), event: b(row, 1), source: b(row, 2), feature: b(row, 3) }), { errors: true });
  }
  if (query.includes("GROUP BY day, source")) return group(list, (row) => ({ day: dayOf(row.timestamp), source: b(row, 2) }), {});
  if (query.includes("GROUP BY day, signed_in")) return group(list, (row) => ({ day: dayOf(row.timestamp), signed_in: b(row, 14) }), { distinct: 12 });
  if (query.includes("GROUP BY week, signed_in")) return group(list, (row) => ({ week: weekOf(row.timestamp), signed_in: b(row, 14) }), { distinct: 13 });
  if (query.includes("GROUP BY event, feature")) return byCount(group(list, (row) => ({ event: b(row, 1), feature: b(row, 3) }), { errors: true }));
  if (query.includes("GROUP BY tool")) return byCount(group(list, (row) => ({ tool: b(row, 4) }), { errors: true }));
  if (query.includes("GROUP BY kind, id")) return byCount(group(list, (row) => ({ kind: b(row, 5), id: b(row, 6) }), {}));
  if (query.includes("GROUP BY event, route")) return byCount(group(list, (row) => ({ event: b(row, 1), route: b(row, 15) }), {}));
  if (query.includes("GROUP BY country")) return byCount(group(list, (row) => ({ country: b(row, 10) }), {}));
  return null;
}

createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const query = body.replace(/\s+FORMAT JSON\s*$/, "");
    const data = request.method === "POST" && request.headers.authorization?.startsWith("Bearer ") ? answer(query) : null;
    console.log(`[usage-sql-mock] ${data ? 200 : 400} ${query.slice(0, 110)}…`);
    response.writeHead(data ? 200 : 400, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data ? { meta: [], data, rows: data.length } : { errors: [{ message: "Unsupported query" }] }));
  });
}).listen(port, "127.0.0.1", () => console.log(`[usage-sql-mock] SQL API stand-in on http://127.0.0.1:${port}/sql`));

if (command.length) {
  const child = spawn(command[0], command.slice(1), { stdio: ["inherit", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      console.log(line);
      ingest(line);
    });
  }
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}
