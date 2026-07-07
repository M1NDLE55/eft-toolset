// Panel model for the layer toggles. Kept free of leaflet imports so server
// components and the (SSR'd) viewer page can use it; leaflet-side building
// lives in layers.ts.
import type { MapDetails, SpawnKind } from "@/app/lib/types/raidPlanner";

export interface LayerOption {
  id: string;
  label: string;
  count: number;
}

export interface LayerGroupOptions {
  name: string;
  options: LayerOption[];
}

export const SPAWN_KIND_LABELS: { kind: SpawnKind; label: string }[] = [
  { kind: "pmc", label: "PMC" },
  { kind: "scav", label: "Scav" },
  { kind: "sniper", label: "Sniper scav" },
  { kind: "boss", label: "Boss" },
  { kind: "raider", label: "Raider / Rogue" },
];

/** Grouped toggles with counts, zero-count entries dropped. */
export function getLayerGroups(details: MapDetails): LayerGroupOptions[] {
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
