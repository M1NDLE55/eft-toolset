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
}

export interface MapTransit {
  id: string;
  description: string;
  position: Required<GamePoint>;
}

export interface MapSpawn {
  zoneName: string | null;
  kind: SpawnKind;
  position: Required<GamePoint>;
}

export interface MapLock {
  lockType: string;
  needsPower: boolean;
  position: Required<GamePoint>;
  keyId: string | null;
  keyName: string | null;
}

export interface MapHazard {
  hazardType: string;
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
  spawnChance: number;
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
  bosses: MapBoss[];
}
