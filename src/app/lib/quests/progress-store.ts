import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import type { GameMode } from "@/components/game-mode/mode";
import { withPrerequisites } from "./availability";
import type { QuestGraph } from "./graph";
import { isFaction, type Faction, type QuestProgress } from "./types";

export const MAX_COMPLETED_QUESTS = 2_000;
export const MAX_DONE_OBJECTIVES = 10_000;
export const MAX_PLAYER_LEVEL = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** PVP and PVE are separate accounts, so each keeps its own progress. */
export type QuestProgressSettings = Record<GameMode, QuestProgress>;

const emptyProgress = (): QuestProgress => ({ completed: [], objectives: [], level: null, faction: null });

const isIdList = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((id) => typeof id === "string" && ID.test(id)) &&
  new Set(value).size === value.length;

const isLevel = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PLAYER_LEVEL;

function isProgress(value: unknown): value is QuestProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Partial<Record<keyof QuestProgress, unknown>>;
  return (
    isIdList(progress.completed, MAX_COMPLETED_QUESTS) &&
    isIdList(progress.objectives, MAX_DONE_OBJECTIVES) &&
    (progress.level === null || isLevel(progress.level)) &&
    (progress.faction === null || isFaction(progress.faction))
  );
}

function isSettings(value: unknown): value is QuestProgressSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return Object.keys(settings).length === 2 && isProgress(settings.regular) && isProgress(settings.pve);
}

function recoverIds(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => typeof id === "string" && ID.test(id)))).slice(0, max);
}

function recoverProgress(value: unknown): QuestProgress {
  if (!value || typeof value !== "object") return emptyProgress();
  const progress = value as Partial<Record<keyof QuestProgress, unknown>>;
  return {
    completed: recoverIds(progress.completed, MAX_COMPLETED_QUESTS),
    objectives: recoverIds(progress.objectives, MAX_DONE_OBJECTIVES),
    level: isLevel(progress.level) ? progress.level : null,
    faction: isFaction(progress.faction) ? progress.faction : null,
  };
}

export const QUEST_PROGRESS_STORE: StoreDefinition<QuestProgressSettings> = {
  key: "eft-toolset:quest-progress",
  version: 1,
  defaultValue: () => ({ regular: emptyProgress(), pve: emptyProgress() }),
  validate: isSettings,
  recover: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const { regular, pve } = value as Partial<Record<GameMode, unknown>>;
    return { regular: recoverProgress(regular), pve: recoverProgress(pve) };
  },
};

function update(gameMode: GameMode, change: (progress: QuestProgress) => QuestProgress) {
  const settings = readStore(QUEST_PROGRESS_STORE);
  return writeStore(QUEST_PROGRESS_STORE, { ...settings, [gameMode]: change(settings[gameMode]) })[gameMode];
}

/**
 * Marks a quest complete, with every quest it needed completed first (`withPrerequisites`),
 * since the player can't have done it otherwise. Returns the quests newly marked, this one included.
 */
export function completeQuest(gameMode: GameMode, graph: QuestGraph, id: string): string[] {
  let added: string[] = [];
  update(gameMode, (progress) => {
    const completed = new Set(progress.completed);
    added = withPrerequisites(graph, id).filter((entry) => !completed.has(entry));
    if (!graph.byId.has(id) && !completed.has(id)) added = [id];
    return { ...progress, completed: [...progress.completed, ...added] };
  });
  return added;
}

/**
 * Un-marks only this quest. Quests that needed it stay complete; `completedDependents` lists
 * them, for the page to point out or offer to un-mark too.
 */
export function uncompleteQuest(gameMode: GameMode, id: string) {
  update(gameMode, (progress) => ({ ...progress, completed: progress.completed.filter((entry) => entry !== id) }));
}

export function setObjectiveDone(gameMode: GameMode, objectiveId: string, done: boolean) {
  update(gameMode, (progress) => {
    const objectives = progress.objectives.filter((entry) => entry !== objectiveId);
    return { ...progress, objectives: done ? [...objectives, objectiveId] : objectives };
  });
}

/** A whole level from 1 to MAX_PLAYER_LEVEL, or null to stop checking levels. */
export function setPlayerLevel(gameMode: GameMode, level: number | null) {
  update(gameMode, (progress) => ({ ...progress, level }));
}

export function setFaction(gameMode: GameMode, faction: Faction | null) {
  update(gameMode, (progress) => ({ ...progress, faction }));
}

export function resetQuestProgress(gameMode: GameMode) {
  update(gameMode, emptyProgress);
}

/** One game mode's progress; the server render and first client render see empty progress. */
export function useQuestProgress(gameMode: GameMode): QuestProgress {
  return useStore(QUEST_PROGRESS_STORE)[gameMode];
}
