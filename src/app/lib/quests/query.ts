import { useMemo } from "react";
import { useGameMode, type GameMode } from "@/components/game-mode/context";
import { apiFetch } from "@/app/lib/api/transport";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { primeQuery, type QueryDefinition } from "@/app/lib/api/queryClient";
import { useDataQuery } from "@/app/lib/api/useDataQuery";
import { isItemSlug } from "@/app/lib/item-links";
import { isFaction, type QuestItemNeed, type QuestList, type QuestRequirement, type QuestSummary } from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_QUESTS = 5_000;
const MAX_ENTRIES = 1_000;
const MAX_ITEMS = 20_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

interface ModeVariables {
  gameMode: GameMode;
}

export const questListQuery: QueryDefinition<ModeVariables, QuestList> = {
  id: "quest-list",
  version: 1,
  staleTime: 30 * MINUTE,
  maxAge: 7 * DAY,
  persist: true,
  validate: isQuestList,
  fetch: ({ gameMode }, signal) => apiFetch<QuestList>(TARKOV_OPERATIONS.questList, { gameMode }, { signal }),
};

/** Seeds the client cache with the list the server rendered; call once, in the browser. */
export function primeQuestList(gameMode: GameMode, list: QuestList, updatedAt: number) {
  primeQuery(questListQuery, { gameMode }, list, updatedAt);
}

/** The quest list for the visitor's game mode, refetched when the mode changes. */
export function useQuestList() {
  const { gameMode, hydrated } = useGameMode();
  const variables = useMemo(() => ({ gameMode }), [gameMode]);
  const query = useDataQuery(questListQuery, variables, { enabled: hydrated });
  return {
    gameMode,
    hydrated,
    list: query.data ?? null,
    loading: !query.data && query.status !== "error",
    error: query.data ? null : (query.error ?? null),
    stale: query.stale,
    retry: () => void query.refresh().catch(() => undefined),
  };
}

export function isQuestList(value: unknown): value is QuestList {
  if (!isRecord(value)) return false;
  const list = value as Partial<Record<keyof QuestList, unknown>>;
  return (
    Array.isArray(list.quests) &&
    list.quests.length <= MAX_QUESTS &&
    list.quests.every(isQuestSummary) &&
    dictionary(list.items, MAX_ITEMS, (item) =>
      isRecord(item) &&
      isText(item.name) &&
      (item.shortName === null || isText(item.shortName)) &&
      (item.slug === null || (typeof item.slug === "string" && isItemSlug(item.slug))) &&
      (item.image === null || isAssetUrl(item.image))
    ) &&
    dictionary(list.maps, MAX_ENTRIES, (map) =>
      isRecord(map) &&
      typeof map.key === "string" &&
      isItemSlug(map.key) &&
      isText(map.name) &&
      (map.page === null || (typeof map.page === "string" && isItemSlug(map.page)))
    ) &&
    Array.isArray(list.traders) &&
    list.traders.length <= MAX_ENTRIES &&
    list.traders.every(isText)
  );
}

function isQuestSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const quest = value as Partial<Record<keyof QuestSummary, unknown>>;
  return (
    isId(quest.id) &&
    isText(quest.name) &&
    (quest.slug === null || (typeof quest.slug === "string" && isItemSlug(quest.slug))) &&
    (quest.trader === null || isText(quest.trader)) &&
    isNumber(quest.minPlayerLevel) &&
    (quest.faction === null || isFaction(quest.faction)) &&
    typeof quest.kappaRequired === "boolean" &&
    typeof quest.lightkeeperRequired === "boolean" &&
    list(quest.maps, (key) => typeof key === "string" && isItemSlug(key)) &&
    list(quest.requires, isRequirement) &&
    list(quest.traderLevels, (entry) => isRecord(entry) && isText(entry.trader) && isNumber(entry.level)) &&
    list(quest.failedBy, isRequirement) &&
    (quest.prestige === null || isNumber(quest.prestige)) &&
    isNumber(quest.experience) &&
    list(quest.needs, isNeed) &&
    list(quest.keys, (entry) =>
      isRecord(entry) && (entry.map === null || (typeof entry.map === "string" && isItemSlug(entry.map))) && list(entry.keys, isId)
    ) &&
    list(quest.objectives, isId) &&
    list(quest.optionalObjectives, isId) &&
    (quest.image === null || isAssetUrl(quest.image))
  );
}

function isRequirement(value: unknown): value is QuestRequirement {
  return (
    isRecord(value) &&
    isId(value.id) &&
    list(value.status, (status) => status === "complete" || status === "active" || status === "failed")
  );
}

function isNeed(value: unknown): value is QuestItemNeed {
  if (!isRecord(value)) return false;
  return (
    list(value.objectives, isId) &&
    list(value.items, isId) &&
    isNumber(value.count) &&
    typeof value.foundInRaid === "boolean" &&
    (value.label === undefined || (typeof value.label === "string" && value.label.length <= 2_000)) &&
    (value.alternatives === undefined || isNumber(value.alternatives))
  );
}

function list(value: unknown, predicate: (entry: unknown) => boolean) {
  return Array.isArray(value) && value.length <= MAX_ENTRIES && value.every(predicate);
}

function dictionary(value: unknown, max: number, predicate: (entry: unknown) => boolean) {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= max && entries.every(([key, entry]) => ID.test(key) && predicate(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 500;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "assets.tarkov.dev" && !url.username && !url.password;
  } catch {
    return false;
  }
}
