import type { MapDetails, SpawnKind } from "@/app/lib/types/raidPlanner";
import type { MapConfig } from "./types";

export interface LayerOption {
  id: string;
  label: string;
  count: number;
}

export interface LayerGroupOptions {
  name: string;
  options: LayerOption[];
}

const SPAWN_KIND_LABELS: { kind: SpawnKind; label: string }[] = [
  { kind: "pmc", label: "PMC" },
  { kind: "scav", label: "Scav" },
  { kind: "sniper", label: "Sniper scav" },
  { kind: "boss", label: "Boss" },
  { kind: "raider", label: "Raider / Rogue" },
];

export const LABELS_LAYER = "labels";

/** Layers shown on a map the viewer has never customised. */
export const DEFAULT_LAYER_IDS = [
  LABELS_LAYER,
  "extracts:pmc",
  "extracts:shared",
  "transits",
  "spawns:pmc",
] as const;

/**
 * The default layers for a map, without ones it has nothing to show for.
 * Before the map details load, only the place names can be checked.
 */
export function getDefaultLayers(config: Pick<MapConfig, "labels">, details: MapDetails | null): string[] {
  const available = details
    ? new Set(getLayerGroups(details, config).flatMap((group) => group.options.map((option) => option.id)))
    : null;
  return DEFAULT_LAYER_IDS.filter((id) =>
    id === LABELS_LAYER ? Boolean(config.labels?.length) : !available || available.has(id)
  );
}

export function getLayerGroups(
  details: MapDetails,
  config?: Pick<MapConfig, "labels">
): LayerGroupOptions[] {
  const extractCount = (faction: string) =>
    details.extracts.filter((e) => e.faction === faction).length;

  const lootCounts = new Map<string, { label: string; count: number }>();
  for (const container of details.lootContainers) {
    const entry = lootCounts.get(container.typeId);
    if (entry) entry.count += 1;
    else lootCounts.set(container.typeId, { label: container.typeName, count: 1 });
  }

  const groups: LayerGroupOptions[] = [
    {
      name: "Map",
      options: [{ id: LABELS_LAYER, label: "Place names", count: config?.labels?.length ?? 0 }],
    },
    {
      name: "Extractions",
      options: [
        { id: "extracts:pmc", label: "PMC", count: extractCount("pmc") },
        { id: "extracts:scav", label: "Scav", count: extractCount("scav") },
        { id: "extracts:shared", label: "Shared", count: extractCount("shared") },
        { id: "transits", label: "Transits", count: details.transits.length },
      ],
    },
    {
      name: "Spawns",
      options: SPAWN_KIND_LABELS.map(({ kind, label }) => ({
        id: `spawns:${kind}`,
        label,
        count: details.spawns.filter((s) => s.kind === kind).length,
      })),
    },
    {
      name: "Points of interest",
      options: [
        { id: "locks", label: "Locks", count: details.locks.length },
        { id: "hazards", label: "Hazards", count: details.hazards.length },
        { id: "switches", label: "Switches", count: details.switches.length },
        {
          id: "stationary",
          label: "Stationary weapons",
          count: details.stationaryWeapons.length,
        },
      ],
    },
    {
      name: "Loot containers",
      options: Array.from(lootCounts, ([typeId, { label, count }]) => ({
        id: `loot:${typeId}`,
        label,
        count,
      })).sort((a, b) => b.count - a.count),
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => option.count > 0),
    }))
    .filter((group) => group.options.length > 0);
}
