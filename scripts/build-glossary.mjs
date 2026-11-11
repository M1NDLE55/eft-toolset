// Run after editing terms.json: node scripts/build-glossary.mjs [--check]. See DATA_ARCHITECTURE.md.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TERMS_PATH = join(ROOT, "src/app/lib/glossary/terms.json");
const LABELS_PATH = join(ROOT, "src/app/lib/glossary/map-labels.json");
const MAPS_URL = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json";
const MCP_URL = process.env.EFT_MCP_URL ?? "https://www.eft-toolset.com/api/mcp";
const CHECK = process.argv.includes("--check");

let requestId = 0;
async function callTool(name, args) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.result?.isError) {
    throw new Error(`${name} ${JSON.stringify(args)}: ${JSON.stringify(body.error ?? body.result.content)}`);
  }
  return body.result.structuredContent;
}

const round = (value) => Math.round(value * 10) / 10;
const point = (entry) => ({
  x: round(entry.x),
  z: round(entry.z),
  ...(typeof entry.y === "number" ? { y: round(entry.y) } : {}),
});

/** Map labels in game coordinates: [x, z], shown between heights bottom and top. */
async function loadLabels() {
  const response = await fetch(MAPS_URL);
  if (!response.ok) throw new Error(`maps.json: HTTP ${response.status}`);
  const groups = await response.json();
  const labels = {};
  for (const group of groups) {
    for (const map of group.maps ?? []) {
      if (map.projection !== "interactive" || !map.labels?.length) continue;
      labels[map.key] = map.labels.map((label) => ({
        name: label.text,
        x: label.position[0],
        z: label.position[1],
        // A label drawn for a height band sits on the level in its middle.
        ...(typeof label.top === "number" && typeof label.bottom === "number"
          ? { y: round((label.top + label.bottom) / 2) }
          : {}),
      }));
    }
  }
  return labels;
}

async function loadPlaces(map) {
  const details = await callTool("get_map_details", {
    map,
    sections: ["extracts", "transits", "bosses", "areas", "hazards", "switches", "stationaryWeapons"],
  });
  const locks = [];
  for (let offset = 0; offset !== null; ) {
    const page = await callTool("get_map_details", { map, sections: ["locks"], lockOffset: offset });
    locks.push(...(page.locks ?? []));
    offset = page.nextLockOffset ?? null;
  }
  const places = new Map();
  const add = (kind, name, entry) => {
    const key = `${kind}|${name}`;
    if (name && !places.has(key)) places.set(key, point(entry));
  };
  for (const entry of details.extracts ?? []) add("extract", entry.name, entry);
  for (const entry of details.transits ?? []) add("transit", entry.name, entry);
  for (const entry of details.areas ?? []) add("area", entry.name, entry);
  for (const entry of details.spawnZones ?? []) add("spawnZone", entry.zone, entry);
  for (const boss of details.bosses ?? []) {
    for (const location of boss.locations ?? []) {
      if (typeof location.x === "number") add("bossLocation", `${boss.name} @ ${location.name}`, location);
    }
  }
  for (const entry of details.hazards ?? []) add("hazard", entry.name, entry);
  for (const entry of details.switches ?? []) add("switch", entry.name, entry);
  for (const entry of details.stationaryWeapons ?? []) add("stationaryWeapon", entry.name, entry);
  for (const entry of locks) add("lock", entry.key, entry);
  return places;
}

async function resolveItem(name) {
  const result = await callTool("search_items", { query: name });
  const match = (result.results ?? []).find((item) => item.name === name);
  return match ? { id: match.id, name: match.name, slug: match.slug } : null;
}

async function inBatches(values, size, work) {
  const results = [];
  for (let start = 0; start < values.length; start += size) {
    results.push(...(await Promise.all(values.slice(start, start + size).map(work))));
  }
  return results;
}

const terms = JSON.parse(readFileSync(TERMS_PATH, "utf8"));
const labels = await loadLabels();
const problems = [];

const maps = [...new Set(terms.flatMap((term) => (term.at && term.at.kind !== "label" ? [term.map] : [])))];
const placesByMap = new Map(await inBatches(maps, 4, async (map) => [map, await loadPlaces(map)]));

const itemNames = [...new Set(terms.flatMap((term) => term.items ?? []))];
const items = new Map(await inBatches(itemNames, 6, async (name) => [name, await resolveItem(name)]));

let changed = 0;
const resolved = terms.map((term) => {
  const { position: _position, itemRefs: _itemRefs, source, ...curated } = term;
  let position = null;
  if (term.at) {
    const found =
      term.at.kind === "label"
        ? labels[term.map]?.find((label) => label.name === term.at.name)
        : placesByMap.get(term.map)?.get(`${term.at.kind}|${term.at.name}`);
    if (found) position = point(found);
    else problems.push(`${term.map}: "${term.term}" is anchored to ${term.at.kind} "${term.at.name}", which no longer exists.`);
  }
  const itemRefs = (term.items ?? []).flatMap((name) => {
    const item = items.get(name);
    if (!item) problems.push(`"${term.term}": no item is named "${name}".`);
    return item ? [item] : [];
  });
  // Curated fields first and resolved ones last, so diffs stay readable.
  const next = { ...curated, source, ...(position ? { position } : {}), ...(itemRefs.length ? { itemRefs } : {}) };
  if (JSON.stringify(next) !== JSON.stringify(term)) changed += 1;
  return next;
});

const labelsJson = `${JSON.stringify(labels, null, 2)}\n`;
const termsJson = `${JSON.stringify(resolved, null, 2)}\n`;
const labelsChanged = readFileSync(LABELS_PATH, { encoding: "utf8", flag: "a+" }) !== labelsJson;
if (!CHECK) {
  writeFileSync(TERMS_PATH, termsJson);
  writeFileSync(LABELS_PATH, labelsJson);
}
console.log(
  `${terms.length} terms, ${changed} ${CHECK ? "would change" : "updated"}; map labels ${labelsChanged ? (CHECK ? "would change" : "updated") : "unchanged"}.`
);
for (const problem of problems) console.warn(`- ${problem}`);
if (problems.length) process.exitCode = 1;
