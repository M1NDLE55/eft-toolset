import type { MapBoss, MapDetails, MapExtract } from "@/app/lib/types/raidPlanner";
import type { FaqEntry } from "./item";
import { plural } from "./format";

export interface MapKey {
  name: string;
  normalizedName: string | null;
  /** How many locks on the map it opens. */
  locks: number;
}

export interface MapGuide {
  extracts: Record<MapExtract["faction"], MapExtract[]>;
  bosses: MapBoss[];
  keys: MapKey[];
  /** Locks with no key, such as doors that need power or a switch. */
  keylessLocks: number;
  powerLocks: number;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

// Mobs tarkov.dev lists with the bosses: real spawns, but not what players mean by a map's bosses.
const NOT_A_BOSS = /^(raider|rogue|infected\b|cultist$|sniper|scav|bloodhound)/i;

export function isNamedBoss(boss: Pick<MapBoss, "name">) {
  return !NOT_A_BOSS.test(boss.name);
}

/** One entry per boss: tarkov.dev lists a boss once per spawn group. */
function mergeBosses(bosses: MapBoss[]): MapBoss[] {
  const merged = new Map<string, MapBoss>();
  for (const boss of bosses) {
    if (boss.spawnChance <= 0) continue;
    const seen = merged.get(boss.name);
    if (!seen) {
      merged.set(boss.name, { ...boss, locations: [...boss.locations] });
      continue;
    }
    seen.spawnChance = Math.max(seen.spawnChance, boss.spawnChance);
    seen.escorts = Math.max(seen.escorts, boss.escorts);
    for (const location of boss.locations) {
      if (!seen.locations.some((known) => known.name === location.name)) seen.locations.push(location);
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) =>
      Number(isNamedBoss(b)) - Number(isNamedBoss(a)) || b.spawnChance - a.spawnChance || a.name.localeCompare(b.name)
  );
}

/** The bosses to name in search copy: raiders, rogues and the like don't count. */
function headlineBosses(guide: MapGuide) {
  return guide.bosses.filter(isNamedBoss);
}

/** Groups and de-duplicates the map's data for the written guide under the interactive map. */
export function buildMapGuide(details: MapDetails): MapGuide {
  const extracts: MapGuide["extracts"] = { pmc: [], scav: [], shared: [] };
  const seen = new Set<string>();
  for (const extract of details.extracts) {
    const id = `${extract.faction}/${extract.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    extracts[extract.faction].push(extract);
  }
  for (const list of Object.values(extracts)) list.sort(byName);

  const keys = new Map<string, MapKey>();
  let keylessLocks = 0;
  let powerLocks = 0;
  for (const lock of details.locks) {
    if (lock.needsPower) powerLocks += 1;
    if (!lock.keyName) {
      keylessLocks += 1;
      continue;
    }
    const key = keys.get(lock.keyName) ?? { name: lock.keyName, normalizedName: lock.keyNormalizedName ?? null, locks: 0 };
    key.locks += 1;
    keys.set(lock.keyName, key);
  }

  const bosses = mergeBosses(details.bosses ?? []);
  return { extracts, bosses, keys: Array.from(keys.values()).sort(byName), keylessLocks, powerLocks };
}

export function formatChance(chance: number) {
  return `${Math.round(chance * 100)}%`;
}

function list(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The map facts the guide and its FAQ quote, apart from what buildMapGuide collects. */
export type MapGuideFacts = Pick<MapDetails, "players" | "raidDuration" | "transits">;

export function mapGuideFacts(details: MapDetails): MapGuideFacts {
  return { players: details.players, raidDuration: details.raidDuration, transits: details.transits };
}

export function mapIntro(mapName: string, details: MapGuideFacts, guide: MapGuide) {
  const facts = [
    details.players ? `${details.players} players` : null,
    details.raidDuration ? `${details.raidDuration}-minute raids` : null,
  ].filter(Boolean);
  const counts = [
    plural(guide.extracts.pmc.length + guide.extracts.shared.length, "PMC extract"),
    plural(guide.extracts.scav.length + guide.extracts.shared.length, "Scav extract"),
    details.transits.length ? plural(details.transits.length, "transit") : null,
    guide.bosses.some(isNamedBoss) ? plural(guide.bosses.filter(isNamedBoss).length, "boss", "bosses") : null,
    guide.keys.length ? plural(guide.keys.length, "key") : null,
  ].filter(Boolean) as string[];
  return (
    `${mapName} is an Escape from Tarkov location${facts.length ? ` with ${list(facts as string[])}` : ""}. ` +
    `This interactive ${mapName} map shows ${list(counts)}, along with PMC and Scav spawns, locked doors, hazards and loot containers. ` +
    "Toggle them in the layers panel, switch floors, or press Plan to draw a route and share it with your squad."
  );
}

export function mapDescription(mapName: string, details: MapDetails | undefined, guide: MapGuide | undefined) {
  if (!details || !guide) {
    return `Interactive ${mapName} map for Escape from Tarkov: every extract, transit, PMC and Scav spawn, boss, key and loot container. Plan routes and share them.`;
  }
  const pmc = guide.extracts.pmc.length + guide.extracts.shared.length;
  const scav = guide.extracts.scav.length + guide.extracts.shared.length;
  const bosses = headlineBosses(guide).map((boss) => boss.name);
  return (
    `Interactive ${mapName} map for Escape from Tarkov with all ${pmc} PMC and ${scav} Scav extracts` +
    (bosses.length ? `, ${list(bosses.slice(0, 3))} spawns` : ", spawns") +
    `, keys and loot. Plan routes and share them.`
  );
}

export function mapFaq(mapName: string, details: MapGuideFacts, guide: MapGuide): FaqEntry[] {
  const entries: FaqEntry[] = [];
  const pmc = [...guide.extracts.pmc, ...guide.extracts.shared].map((extract) => extract.name);
  const scav = [...guide.extracts.scav, ...guide.extracts.shared].map((extract) => extract.name);
  if (pmc.length || scav.length) {
    entries.push({
      question: `How many extracts are on ${mapName}?`,
      answer:
        `${mapName} has ${plural(pmc.length, "PMC extract")}` +
        (pmc.length ? ` (${list(pmc)})` : "") +
        ` and ${plural(scav.length, "Scav extract")}. Some extracts only open at certain times, need an item or a fee, or need power: check the map's extract layer before you commit.`,
    });
  }
  if (headlineBosses(guide).length) {
    entries.push({
      question: `Which bosses spawn on ${mapName}?`,
      answer: `${list(headlineBosses(guide).map((boss) => `${boss.name} (${formatChance(boss.spawnChance)} spawn chance)`))}. Turn on the boss spawn layer to see where each one can appear.`,
    });
  }
  if (details.raidDuration || details.players) {
    entries.push({
      question: `How long is a raid on ${mapName}?`,
      answer:
        (details.raidDuration ? `A ${mapName} raid lasts ${details.raidDuration} minutes` : `${mapName} raids`) +
        (details.players ? ` with ${details.players} players.` : "."),
    });
  }
  if (guide.keys.length) {
    entries.push({
      question: `What keys do I need for ${mapName}?`,
      answer: `${plural(guide.keys.length, "key")} open locks on ${mapName}. The key layer shows each locked door and which key opens it, and each key's page has its current price.`,
    });
  }
  return entries;
}
