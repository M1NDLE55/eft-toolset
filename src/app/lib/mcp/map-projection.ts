import { getFloorStack } from "@/app/lib/raid-planner/floors";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { describePosition, resolveMap, spawnZoneName, spawnZones } from "@/app/lib/raid-planner/resolve";
import { normalizeText } from "@/app/lib/search/normalize-text";
import type { GameMode, Read, ToolContext } from "./context";
import { page } from "./schemas";
import { loadMapDetails } from "./sources";

// How get_map_details describes a map.

export const SECTIONS = [
  "extracts",
  "transits",
  "spawns",
  "locks",
  "hazards",
  "switches",
  "stationaryWeapons",
  "lootContainers",
] as const;
type Section = (typeof SECTIONS)[number];

export const DEFAULT_SECTIONS: Section[] = ["extracts", "transits", "hazards", "switches", "stationaryWeapons"];
const MAX_LOOT_CONTAINERS = 150;

interface MapQuery {
  map: string;
  sections?: readonly Section[];
  lootContainerTypes?: readonly string[];
  lootOffset: number;
  gameMode: GameMode;
}

export async function describeMap(
  context: ToolContext,
  read: Read,
  { map, sections, lootContainerTypes, lootOffset, gameMode }: MapQuery
) {
  const config = resolveMap(map);
  const details = await loadMapDetails(read, gameMode, config);
  const wanted = new Set<Section>(sections ?? DEFAULT_SECTIONS);
  const typeNeedles = (lootContainerTypes ?? []).map(normalizeText);
  const loot = details.lootContainers.filter(
    (container) =>
      typeNeedles.length === 0 || typeNeedles.some((needle) => normalizeText(container.typeName).includes(needle))
  );
  if (typeNeedles.length > 0) wanted.add("lootContainers");
  const lootPage = page(loot, lootOffset, MAX_LOOT_CONTAINERS);
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
            ...describePosition(config, extract.position),
          })),
        }
      : {}),
    ...(wanted.has("transits")
      ? { transits: details.transits.map((transit) => ({ name: transit.description, ...describePosition(config, transit.position) })) }
      : {}),
    ...(!wanted.has("spawns") ? { spawnZones: spawnZones(config, details) } : {}),
    ...(wanted.has("spawns")
      ? {
          spawns: details.spawns.map((spawn) => ({
            kind: spawn.kind,
            zone: spawnZoneName(spawn.zoneName),
            ...describePosition(config, spawn.position),
          })),
        }
      : {}),
    ...(wanted.has("locks")
      ? {
          locks: details.locks.map((lock) => ({
            type: lock.lockType,
            key: lock.keyName,
            keyUrl: lock.keyNormalizedName ? `${context.origin}/item/${lock.keyNormalizedName}` : null,
            needsPower: lock.needsPower,
            ...describePosition(config, lock.position),
          })),
        }
      : {}),
    ...(wanted.has("hazards")
      ? { hazards: details.hazards.map((hazard) => ({ name: hazard.name, ...describePosition(config, hazard.position) })) }
      : {}),
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
