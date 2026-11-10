import { floorAt, getFloorStack } from "@/app/lib/raid-planner/floors";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import {
  describePosition,
  lockAreas,
  resolveMap,
  spawnZoneName,
  spawnZones,
} from "@/app/lib/raid-planner/resolve";
import { normalizeText } from "@/app/lib/search/normalize-text";
import type { GamePoint, MapConfig } from "@/app/lib/raid-planner/types";
import type { MapDetails, SpawnKind } from "@/app/lib/types/raidPlanner";
import type { GameMode, Read, ToolContext } from "./context";
import { page } from "./schemas";
import { loadMapDetails } from "./sources";

// How get_map_details describes a map.

export const SECTIONS = [
  "extracts",
  "transits",
  "bosses",
  "areas",
  "spawns",
  "locks",
  "hazards",
  "switches",
  "stationaryWeapons",
  "lootContainers",
] as const;
type Section = (typeof SECTIONS)[number];

export const DEFAULT_SECTIONS: Section[] = ["extracts", "transits", "bosses", "areas", "hazards", "switches", "stationaryWeapons"];
export const SPAWN_KINDS = ["pmc", "scav", "sniper", "boss", "raider"] as const satisfies readonly SpawnKind[];

/** Spawn points, locks, and loot containers listed in one call, shared by the sections asked for. */
export const MAX_LISTED_ROWS = 80;
const MAX_BOSSES = 30;

interface MapQuery {
  map: string;
  sections?: readonly Section[];
  spawnKinds?: readonly SpawnKind[];
  lockKeys?: readonly string[];
  lootContainerTypes?: readonly string[];
  spawnOffset?: number;
  lockOffset?: number;
  lootOffset: number;
  gameMode: GameMode;
}

function matchesAny(value: string | null, needles: readonly string[]) {
  if (needles.length === 0) return true;
  const haystack = normalizeText(value ?? "").replace(/['’]/g, "");
  return needles.some((needle) => haystack.includes(normalizeText(needle).replace(/['’]/g, "")));
}

function percent(chance: number) {
  return `${Math.round(chance * 100)}%`;
}

function centreOf(points: GamePoint[]): GamePoint {
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    z: points.reduce((total, point) => total + point.z, 0) / points.length,
  };
}

/** A centre of several points, to the metre, with the base level since its height means little. */
function roughPosition(config: MapConfig, point: GamePoint) {
  return { x: Math.round(point.x), z: Math.round(point.z), level: floorAt(config, { x: point.x, z: point.z }).name };
}

type Boss = NonNullable<MapDetails["bosses"]>[number];

/** Boss spawns, merging identical entries, with coordinates for the locations the map has spawn points for. */
function describeBosses(config: MapConfig, details: MapDetails) {
  const zonePoints = new Map<string, GamePoint[]>();
  for (const spawn of details.spawns) {
    if (spawn.zoneName) zonePoints.set(spawn.zoneName, [...(zonePoints.get(spawn.zoneName) ?? []), spawn.position]);
  }
  const describe = (boss: Boss) => ({
    name: boss.name,
    spawnChance: boss.spawnChance,
    locations: boss.locations.map((location) => {
      const points = zonePoints.get(location.zone);
      return {
        name: location.name,
        chance: location.chance,
        ...(points ? roughPosition(config, centreOf(points)) : {}),
      };
    }),
    ...(boss.escorts ? { escorts: boss.escorts } : {}),
    ...(boss.spawnTimeSeconds !== null ? { spawnTimeSeconds: boss.spawnTimeSeconds } : {}),
    ...(boss.trigger ? { trigger: boss.trigger } : {}),
  });
  const rows = new Map<string, { row: ReturnType<typeof describe>; count: number }>();
  for (const boss of details.bosses ?? []) {
    const row = describe(boss);
    const key = JSON.stringify(row);
    const existing = rows.get(key);
    if (existing) existing.count += 1;
    else rows.set(key, { row, count: 1 });
  }
  return Array.from(rows.values())
    .slice(0, MAX_BOSSES)
    .map(({ row, count }) => (count > 1 ? { ...row, count } : row));
}

/** Which bosses can use each boss spawn zone, as "Reshala 33%". */
function bossesByZone(details: MapDetails) {
  const byZone = new Map<string, string[]>();
  for (const boss of details.bosses ?? []) {
    for (const location of boss.locations) {
      const label = `${boss.name} ${percent(boss.spawnChance * location.chance)}`;
      const list = byZone.get(location.zone) ?? [];
      if (!list.includes(label)) list.push(label);
      byZone.set(location.zone, list);
    }
  }
  return byZone;
}

export async function describeMap(
  context: ToolContext,
  read: Read,
  {
    map,
    sections,
    spawnKinds = [],
    lockKeys = [],
    lootContainerTypes = [],
    spawnOffset = 0,
    lockOffset = 0,
    lootOffset,
    gameMode,
  }: MapQuery
) {
  const config = resolveMap(map);
  const details = await loadMapDetails(read, gameMode, config);
  const wanted = new Set<Section>(sections ?? DEFAULT_SECTIONS);
  // A filter asks for its section.
  if (spawnKinds.length > 0) wanted.add("spawns");
  if (lockKeys.length > 0) wanted.add("locks");
  if (lootContainerTypes.length > 0) wanted.add("lootContainers");

  const listed = (["spawns", "locks", "lootContainers"] as const).filter((section) => wanted.has(section));
  const rowsPerSection = Math.floor(MAX_LISTED_ROWS / Math.max(1, listed.length));

  const spawns = details.spawns.filter((spawn) => spawnKinds.length === 0 || spawnKinds.includes(spawn.kind));
  const locks = details.locks.filter((lock) => matchesAny(lock.keyName, lockKeys));
  const loot = details.lootContainers.filter((container) => matchesAny(container.typeName, lootContainerTypes));
  const spawnPage = page(spawns, spawnOffset, rowsPerSection);
  const lockPage = page(locks, lockOffset, rowsPerSection);
  const lootPage = page(loot, lootOffset, rowsPerSection);
  const zoneBosses = bossesByZone(details);

  return {
    gameMode,
    key: config.key,
    name: config.name,
    url: `${context.origin}/raid-planner/map/${config.key}`,
    players: details.players,
    raidDurationMinutes: details.raidDuration,
    levels: getFloorStack(config).map((floor) => floor.name),
    layers: getLayerGroups(details).map((group) => ({
      group: group.name,
      options: group.options.map((option) => ({ id: option.id, label: option.label, count: option.count })),
    })),
    ...(wanted.has("extracts")
      ? {
          extracts: details.extracts.map((extract) => ({
            name: extract.name,
            faction: extract.faction,
            ...(extract.transferItem
              ? {
                  requiresItem:
                    extract.transferItem.count > 1
                      ? `${extract.transferItem.count.toLocaleString("en-US")} ${extract.transferItem.name}`
                      : extract.transferItem.name,
                }
              : {}),
            ...describePosition(config, extract.position),
          })),
        }
      : {}),
    ...(wanted.has("transits")
      ? { transits: details.transits.map((transit) => ({ name: transit.description, ...describePosition(config, transit.position) })) }
      : {}),
    ...(wanted.has("bosses") ? { bosses: describeBosses(config, details) } : {}),
    ...(wanted.has("areas")
      ? {
          areas: lockAreas(details).map((area) => ({
            name: area.name,
            source: area.derived ?? null,
            ...roughPosition(config, area.position),
          })),
        }
      : {}),
    ...(!wanted.has("spawns")
      ? {
          spawnZones: spawnZones(config, details).map(({ zoneId, ...zone }) => {
            const bosses = zone.kind === "boss" && zoneId ? zoneBosses.get(zoneId) : undefined;
            return bosses ? { ...zone, bosses } : zone;
          }),
        }
      : {}),
    ...(wanted.has("spawns")
      ? {
          spawnTotal: spawns.length,
          spawns: spawnPage.items.map((spawn) => ({
            kind: spawn.kind,
            zone: spawnZoneName(spawn.zoneName, spawn.zoneLabel),
            ...describePosition(config, spawn.position),
          })),
          nextSpawnOffset: spawnPage.nextOffset,
        }
      : {}),
    ...(wanted.has("locks")
      ? {
          lockTotal: locks.length,
          locks: lockPage.items.map((lock) => ({
            type: lock.lockType,
            key: lock.keyName,
            keyUrl: lock.keyNormalizedName ? `${context.origin}/item/${lock.keyNormalizedName}` : null,
            needsPower: lock.needsPower,
            ...describePosition(config, lock.position),
          })),
          nextLockOffset: lockPage.nextOffset,
        }
      : {}),
    ...(wanted.has("hazards") ? { hazards: groupHazards(config, details) } : {}),
    ...(wanted.has("switches")
      ? { switches: details.switches.map((entry) => ({ name: entry.name, ...describePosition(config, entry.position) })) }
      : {}),
    ...(wanted.has("stationaryWeapons")
      ? {
          stationaryWeapons: details.stationaryWeapons.map((weapon) => ({
            name: weapon.name,
            ...describePosition(config, weapon.position),
          })),
        }
      : {}),
    ...(wanted.has("lootContainers")
      ? {
          lootContainerTotal: loot.length,
          lootContainers: lootPage.items.map((container) => ({
            type: container.typeName,
            ...describePosition(config, container.position),
          })),
          nextLootOffset: lootPage.nextOffset,
        }
      : {}),
  };
}

const HAZARD_CLUSTER_METERS = 60;

/** Hazards of the same name close together, such as one minefield's mines, as one entry with a count. */
function groupHazards(config: MapConfig, details: MapDetails) {
  const groups: { name: string; points: GamePoint[] }[] = [];
  for (const hazard of details.hazards) {
    const group = groups.find(
      (candidate) =>
        candidate.name === hazard.name &&
        candidate.points.some(
          (point) => Math.hypot(point.x - hazard.position.x, point.z - hazard.position.z) <= HAZARD_CLUSTER_METERS
        )
    );
    if (group) group.points.push(hazard.position);
    else groups.push({ name: hazard.name, points: [hazard.position] });
  }
  return groups.map((group) => {
    if (group.points.length === 1) return { name: group.name, ...describePosition(config, group.points[0]) };
    return { name: group.name, count: group.points.length, ...roughPosition(config, centreOf(group.points)) };
  });
}
