import type { GamePoint } from "@/app/lib/raid-planner/types";

export type ExtractFaction = "pmc" | "scav" | "shared";

export type SpawnKind = "pmc" | "scav" | "sniper" | "boss" | "raider";

export interface MapExtract {
  id: string;
  name: string;
  faction: ExtractFaction;
  position: Required<GamePoint>;
  outline: GamePoint[];
  top: number | null;
  bottom: number | null;
  /** Item handed over to use the extract, such as roubles for a car extract. */
  transferItem?: { name: string; count: number } | null;
}

export interface MapTransit {
  id: string;
  description: string;
  position: Required<GamePoint>;
}

export interface MapSpawn {
  zoneName: string | null;
  /** tarkov.dev's English name for the zone, when it has one (for example "Stronghold"). */
  zoneLabel?: string | null;
  kind: SpawnKind;
  position: Required<GamePoint>;
}

export interface MapLock {
  lockType: string;
  needsPower: boolean;
  position: Required<GamePoint>;
  keyName: string | null;
  keyNormalizedName?: string | null;
}

export interface MapHazard {
  name: string;
  position: Required<GamePoint>;
  outline: GamePoint[];
  top: number | null;
  bottom: number | null;
}

export interface MapLootContainer {
  typeId: string;
  typeName: string;
  position: Required<GamePoint>;
}

export interface MapSwitch {
  id: string;
  name: string | null;
  position: Required<GamePoint>;
}

export interface MapStationaryWeapon {
  name: string;
  position: Required<GamePoint>;
}

export interface MapBoss {
  name: string;
  /** 0 to 1. */
  spawnChance: number;
  /** zone is the game's zone id, matching MapSpawn.zoneName. */
  locations: { zone: string; name: string; chance: number }[];
  /** Largest escort group that can come with the boss. */
  escorts: number;
  /** Seconds into the raid when the boss spawns, or null for the raid start. */
  spawnTimeSeconds: number | null;
  /** The game's trigger id when the spawn waits for an event, such as a switch. */
  trigger: string | null;
}

export interface MapDetails {
  key: string;
  players: string | null;
  raidDuration: number | null;
  extracts: MapExtract[];
  transits: MapTransit[];
  spawns: MapSpawn[];
  locks: MapLock[];
  hazards: MapHazard[];
  lootContainers: MapLootContainer[];
  switches: MapSwitch[];
  stationaryWeapons: MapStationaryWeapon[];
  bosses?: MapBoss[];
}
