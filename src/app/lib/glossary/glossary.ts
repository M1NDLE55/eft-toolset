import { floorAt } from "@/app/lib/raid-planner/floors";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import type { Place } from "@/app/lib/raid-planner/resolve";
import type { GamePoint, MapConfig } from "@/app/lib/raid-planner/types";
import { editDistance, nameWords, typoAllowance } from "@/app/lib/search/name-match";
import labelData from "./map-labels.json";
import termData from "./terms.json";

// Escape from Tarkov jargon: what players call places, items, and mechanics, with links to
// the real data. terms.json is curated by hand; scripts/build-glossary.mjs fills in each
// landmark's position (from a tarkov.dev map label or a place in the map data) and each
// item's id. map-labels.json is tarkov.dev's interactive-map labels, in game coordinates.

export const GLOSSARY_CATEGORIES = ["landmark", "map", "boss", "trader", "item", "ammo", "mechanic", "slang"] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

/** Where a landmark's position comes from: a tarkov.dev map label, or a place in the map data. */
export const ANCHOR_KINDS = [
  "label",
  "extract",
  "transit",
  "area",
  "spawnZone",
  "bossLocation",
  "lock",
  "hazard",
  "switch",
  "stationaryWeapon",
] as const;
type AnchorKind = (typeof ANCHOR_KINDS)[number];

export type Confidence = "high" | "medium" | "low";

export interface GlossaryEntry {
  term: string;
  aliases: string[];
  category: GlossaryCategory;
  meaning: string;
  /** Map key: where a landmark is, or the map a boss, item, or map entry belongs to. */
  map?: string;
  /** The place a landmark's position is taken from; null when nothing in the data marks it. */
  at?: { kind: AnchorKind; name: string } | null;
  /** How sure the position is to be at the landmark. */
  confidence?: Confidence | null;
  /** Item names as tarkov.dev has them; build-glossary.mjs resolves them into itemRefs. */
  items?: string[];
  source: string;
  position?: GamePoint;
  itemRefs?: { id: string; name: string; slug: string }[];
}

interface MapLabel {
  name: string;
  x: number;
  z: number;
  y?: number;
}

export const GLOSSARY: readonly GlossaryEntry[] = termData as GlossaryEntry[];
const MAP_LABELS = labelData as Record<string, MapLabel[]>;

const configByKey = new Map(mapConfigs.map((config) => [config.key, config]));

export function mapConfigOf(key: string | undefined): MapConfig | undefined {
  return key ? configByKey.get(key) : undefined;
}

function compactName(value: string) {
  return nameWords(value).join("");
}

/**
 * Labels on tarkov.dev's maps that no curated entry already covers, as landmarks: they name
 * places ("Sniper Hill", "Warehouse 17") that the map data has no other name for.
 */
function labelEntries(): GlossaryEntry[] {
  const covered = new Set(
    GLOSSARY.flatMap((entry) =>
      entry.category === "landmark" && entry.map
        ? [entry.term, ...entry.aliases, ...(entry.at?.kind === "label" ? [entry.at.name] : [])].map(
            (name) => `${entry.map}|${compactName(name)}`
          )
        : []
    )
  );
  const entries: GlossaryEntry[] = [];
  for (const [map, labels] of Object.entries(MAP_LABELS)) {
    const config = configByKey.get(map);
    if (!config) continue;
    for (const label of labels) {
      const key = `${map}|${compactName(label.name)}`;
      // A name labelled more than once, such as a long street, keeps its first label.
      if (!compactName(label.name) || covered.has(key)) continue;
      covered.add(key);
      entries.push({
        term: label.name,
        aliases: [],
        category: "landmark",
        meaning: `A place labelled on tarkov.dev's ${config.name} map.`,
        map,
        at: { kind: "label", name: label.name },
        confidence: "high",
        source: `https://tarkov.dev/map/${map}`,
        position: { x: label.x, z: label.z, ...(label.y !== undefined ? { y: label.y } : {}) },
      });
    }
  }
  return entries;
}

export const ALL_ENTRIES: readonly GlossaryEntry[] = [...GLOSSARY, ...labelEntries()];

interface IndexedName {
  name: string;
  compact: string;
  words: string[];
  entry: GlossaryEntry;
}

const NAMES: IndexedName[] = ALL_ENTRIES.flatMap((entry) =>
  [entry.term, ...entry.aliases].map((name) => {
    const words = nameWords(name);
    return { name, words, compact: words.join(""), entry };
  })
).filter((name) => name.compact);

const BY_COMPACT = new Map<string, IndexedName[]>();
for (const name of NAMES) BY_COMPACT.set(name.compact, [...(BY_COMPACT.get(name.compact) ?? []), name]);
const LONGEST_NAME_WORDS = Math.max(...NAMES.map((name) => name.words.length));

export interface LookupFilter {
  category?: GlossaryCategory;
  /** Only landmarks on this map (other categories are kept). */
  map?: string;
}

function accepts(entry: GlossaryEntry, filter: LookupFilter) {
  if (filter.category && entry.category !== filter.category) return false;
  if (filter.map && entry.category === "landmark" && entry.map !== filter.map) return false;
  return true;
}

function distinctEntries(names: readonly IndexedName[], filter: LookupFilter) {
  return [...new Set(names.map((name) => name.entry))].filter((entry) => accepts(entry, filter));
}

export type LookupResult =
  | { match: "exact" | "typo"; entries: GlossaryEntry[] }
  /** Known terms found inside a longer text, in the order they appear. */
  | { match: "mentions"; entries: GlossaryEntry[]; found: string[] }
  | { match: "none"; entries: []; suggestions: string[] };

/** Words in a text scanned for terms, and terms found in one text. */
const MAX_SCANNED_WORDS = 200;
const MAX_MENTIONS = 15;
/** Shorter names (such as "PS" or "LL") are only matched on their own, not inside a sentence. */
const MIN_MENTION_LENGTH = 3;

export function lookupTerm(text: string, filter: LookupFilter = {}): LookupResult {
  const words = nameWords(text).slice(0, MAX_SCANNED_WORDS);
  const compact = words.join("");
  if (!compact) return { match: "none", entries: [], suggestions: [] };

  const exact = distinctEntries(BY_COMPACT.get(compact) ?? [], filter);
  if (exact.length) return { match: "exact", entries: exact };

  // A short name with a typo is more likely another word than a misspelling.
  const allowance = typoAllowance(compact.length);
  if (allowance > 0 && words.length <= LONGEST_NAME_WORDS) {
    let best = allowance + 1;
    let closest: IndexedName[] = [];
    for (const name of NAMES) {
      if (!accepts(name.entry, filter)) continue;
      const distance = editDistance(compact, name.compact, best);
      if (distance < best) [best, closest] = [distance, [name]];
      else if (distance === best) closest.push(name);
    }
    if (best <= allowance) return { match: "typo", entries: distinctEntries(closest, filter) };
  }

  if (words.length > 1) {
    const found: string[] = [];
    const entries = new Set<GlossaryEntry>();
    for (let start = 0; start < words.length && entries.size < MAX_MENTIONS; ) {
      let length = Math.min(LONGEST_NAME_WORDS, words.length - start);
      for (; length > 0; length -= 1) {
        const key = words.slice(start, start + length).join("");
        if (key.length < MIN_MENTION_LENGTH) continue;
        const hits = distinctEntries(BY_COMPACT.get(key) ?? [], filter);
        if (hits.length === 0) continue;
        found.push(words.slice(start, start + length).join(" "));
        for (const entry of hits) entries.add(entry);
        break;
      }
      start += Math.max(1, length);
    }
    if (entries.size) return { match: "mentions", entries: [...entries].slice(0, MAX_MENTIONS), found };
  }

  const limit = Math.max(2, Math.ceil(compact.length / 3));
  const suggestions = NAMES.filter((name) => accepts(name.entry, filter))
    .map((name) => ({ name, distance: editDistance(compact, name.compact, limit) }))
    .filter((candidate) => candidate.distance <= limit)
    .toSorted((a, b) => a.distance - b.distance)
    .map(({ name }) => describeName(name))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 5);
  return { match: "none", entries: [], suggestions };
}

function describeName({ name, entry }: IndexedName) {
  const where = entry.map && entry.category !== "map" ? `, ${mapConfigOf(entry.map)?.name ?? entry.map}` : "";
  return `${name} (${entry.category}${where})`;
}

/** Entries in a category or on a map, for listing. Landmarks are filtered by map; other entries by the map they belong to. */
export function listTerms(filter: LookupFilter) {
  return ALL_ENTRIES.filter(
    (entry) => (!filter.category || entry.category === filter.category) && (!filter.map || entry.map === filter.map)
  );
}

const ANCHOR_WORDS: Record<AnchorKind, string> = {
  label: "map label",
  extract: "extract",
  transit: "transit",
  area: "key-lock area",
  spawnZone: "spawn zone",
  bossLocation: "boss spawn",
  lock: "lock",
  hazard: "hazard",
  switch: "switch",
  stationaryWeapon: "stationary weapon",
};

/** Where a landmark's position comes from, as "the Tarcone Director's office key lock". */
export function positionSource(entry: GlossaryEntry) {
  if (!entry.at) return null;
  if (entry.at.kind === "label") return `the "${entry.at.name}" label on tarkov.dev's map`;
  return `the ${entry.at.name} ${ANCHOR_WORDS[entry.at.kind]}`;
}

/** A landmark's position with its level, or null when the glossary has none. */
export function landmarkPosition(entry: GlossaryEntry) {
  const config = mapConfigOf(entry.map);
  if (!entry.position || !config) return null;
  return {
    x: entry.position.x,
    z: entry.position.z,
    level: floorAt(config, entry.position).name,
  };
}

const landmarkLists = new Map<string, Place[]>();

function landmarkPlace(entry: GlossaryEntry): Place {
  const rough = entry.confidence && entry.confidence !== "high" ? ` (${entry.confidence} confidence)` : "";
  return {
    kind: "landmark",
    name: entry.term,
    position: entry.position!,
    derived: `position of ${positionSource(entry)}${rough}, for the community name ${entry.term}`,
  };
}

/** Landmarks with a position on a map, as raid-planner places named by their main term. */
export function landmarkPlaces(mapKey: string): Place[] {
  let places = landmarkLists.get(mapKey);
  if (!places) {
    places = ALL_ENTRIES.filter((entry) => entry.category === "landmark" && entry.map === mapKey && entry.position).map(
      landmarkPlace
    );
    landmarkLists.set(mapKey, places);
  }
  return places;
}

/** A landmark on the map whose term or alias is exactly this name (ignoring case and punctuation). */
export function findLandmark(mapKey: string, reference: string): Place | null {
  const entries = distinctEntries(BY_COMPACT.get(compactName(reference)) ?? [], { category: "landmark", map: mapKey });
  const located = entries.find((entry) => entry.position);
  return located ? landmarkPlace(located) : null;
}
