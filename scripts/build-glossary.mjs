// Run after editing terms.json: node scripts/build-glossary.mjs [--check]. See DATA_ARCHITECTURE.md.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeLabel } from "./describe-labels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TERMS_PATH = join(ROOT, "src/app/lib/glossary/terms.json");
const LABELS_PATH = join(ROOT, "src/app/lib/glossary/map-labels.json");
const NOTES_PATH = join(ROOT, "src/app/lib/glossary/label-notes.json");
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

// tarkov.dev leaves a label's height band open-ended with a bound of 100 m or more.
const OPEN_HEIGHT = 100;

/** A height on the level a label's band covers, or nothing when the band has no closed end. */
function labelHeight(bottom, top) {
  const closed = (value) => typeof value === "number" && Math.abs(value) < OPEN_HEIGHT;
  if (closed(bottom) && closed(top)) return round((bottom + top) / 2);
  if (closed(bottom)) return bottom + 1;
  if (closed(top)) return top - 1;
  return undefined;
}

/** Map labels in game coordinates: [x, z], shown between heights bottom and top. */
async function loadLabels() {
  const response = await fetch(MAPS_URL);
  if (!response.ok) throw new Error(`maps.json: HTTP ${response.status}`);
  const groups = await response.json();
  const labels = {};
  const frames = {};
  for (const group of groups) {
    for (const map of group.maps ?? []) {
      if (map.projection !== "interactive" || !map.labels?.length) continue;
      frames[map.key] = { rotation: map.coordinateRotation ?? 0, bounds: map.bounds };
      labels[map.key] = map.labels.map((label) => ({
        name: label.text,
        x: label.position[0],
        z: label.position[1],
        ...(labelHeight(label.bottom, label.top) !== undefined ? { y: labelHeight(label.bottom, label.top) } : {}),
        ...(typeof label.bottom === "number" ? { bottom: label.bottom } : {}),
        ...(typeof label.top === "number" ? { top: label.top } : {}),
      }));
    }
  }
  return { labels, frames };
}

async function pages(map, section, offsetKey, nextKey) {
  const rows = [];
  for (let offset = 0; offset !== null; ) {
    const page = await callTool("get_map_details", { map, sections: [section], [offsetKey]: offset });
    rows.push(...(page[section] ?? []));
    offset = page[nextKey] ?? null;
  }
  return rows;
}

async function loadMap(map) {
  const details = await callTool("get_map_details", {
    map,
    sections: ["extracts", "transits", "bosses", "areas", "hazards", "switches", "stationaryWeapons"],
  });
  const locks = await pages(map, "locks", "lockOffset", "nextLockOffset");
  const loot = await pages(map, "lootContainers", "lootOffset", "nextLootOffset");
  const places = new Map();
  const add = (kind, name, entry) => {
    const key = `${kind}|${name}`;
    if (name && !places.has(key)) places.set(key, point(entry));
  };
  const bosses = (details.bosses ?? []).flatMap((boss) =>
    (boss.locations ?? []).filter((location) => typeof location.x === "number").map((location) => ({ boss, location }))
  );
  for (const entry of details.extracts ?? []) add("extract", entry.name, entry);
  for (const entry of details.transits ?? []) add("transit", entry.name, entry);
  for (const entry of details.areas ?? []) add("area", entry.name, entry);
  for (const entry of details.spawnZones ?? []) add("spawnZone", entry.zone, entry);
  for (const { boss, location } of bosses) add("bossLocation", `${boss.name} @ ${location.name}`, location);
  for (const entry of details.hazards ?? []) add("hazard", entry.name, entry);
  for (const entry of details.switches ?? []) add("switch", entry.name, entry);
  for (const entry of details.stationaryWeapons ?? []) add("stationaryWeapon", entry.name, entry);
  for (const entry of locks) add("lock", entry.key, entry);
  return {
    name: details.name,
    places,
    exits: [
      ...(details.extracts ?? []).map((entry) => ({ ...point(entry), name: entry.name, kind: "extract", faction: entry.faction })),
      ...(details.transits ?? []).map((entry) => ({ ...point(entry), name: entry.name, kind: "transit" })),
    ],
    locks: locks.filter((lock) => lock.key).map((lock) => ({ ...point(lock), key: lock.key })),
    bosses: bosses.map(({ boss, location }) => ({ ...point(location), name: boss.name })),
    loot: loot.map((container) => ({ ...point(container), type: container.type })),
  };
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
const { labels, frames } = await loadLabels();
const notes = JSON.parse(readFileSync(NOTES_PATH, "utf8"));
const problems = [];

const maps = [
  ...new Set([...Object.keys(labels), ...terms.flatMap((term) => (term.at && term.at.kind !== "label" ? [term.map] : []))]),
];
const mapData = new Map(await inBatches(maps, 4, async (map) => [map, await loadMap(map)]));

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
        : mapData.get(term.map)?.places.get(`${term.at.kind}|${term.at.name}`);
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

for (const [map, mapLabels] of Object.entries(labels)) {
  const data = mapData.get(map);
  const landmarks = resolved.filter((term) => term.category === "landmark" && term.map === map && term.position);
  const context = {
    ...frames[map],
    ...data,
    landmarks: landmarks.map((term) => ({
      name: term.term,
      ...(["extract", "transit"].includes(term.at.kind) ? { exit: term.at.name } : {}),
      ...term.position,
    })),
  };
  for (const label of mapLabels) {
    const note = notes[map]?.[label.name];
    const location = describeLabel(context, label);
    label.meaning = note ? `${note.meaning} ${location}` : location;
    label.source = note?.source ?? `https://tarkov.dev/map/${map}`;
  }
}
for (const [map, mapNotes] of Object.entries(notes)) {
  for (const name of Object.keys(mapNotes)) {
    if (!labels[map]?.some((label) => label.name === name)) problems.push(`${map}: label-notes.json describes "${name}", which no label has.`);
  }
}

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
