import { isItemSlug } from "@/app/lib/item-links";
import type { QuestState } from "./availability";
import type { QuestFilter } from "./filters";
import { MAX_PLAYER_LEVEL } from "./progress-store";

export const QUEST_VIEWS = ["list", "available", "items", "chains", "progress"] as const;
export type QuestView = (typeof QUEST_VIEWS)[number];

export const QUEST_STATES: readonly QuestState[] = ["available", "locked", "completed", "failed"];

/** What the quests page shows, kept in its URL so a view or a search can be shared. */
export interface QuestPageState {
  view: QuestView;
  text: string;
  trader: string | null;
  /** A map's page key (factory), which also matches its variants. */
  map: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  kappa: boolean;
  lightkeeper: boolean;
  /** Only quests that need items found in raid. */
  fir: boolean;
  states: QuestState[];
  /** Leave out the other faction's quests. */
  ownFaction: boolean;
  /** Items needed: for every quest still to do, or only those available now. */
  scope: "remaining" | "available";
  /** Chains: drawn as a tree, or listed step by step for narrow screens. */
  layout: "tree" | "steps";
}

export const DEFAULT_QUEST_PAGE_STATE: QuestPageState = {
  view: "list",
  text: "",
  trader: null,
  map: null,
  minLevel: null,
  maxLevel: null,
  kappa: false,
  lightkeeper: false,
  fir: false,
  states: [],
  ownFaction: false,
  scope: "remaining",
  layout: "tree",
};

const MAX_TEXT = 100;
const MAX_TRADER = 60;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function level(value: string | null) {
  if (!value || !/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= MAX_PLAYER_LEVEL ? number : null;
}

const flag = (value: string | null) => value === "1";

/** Reads the page state from its query string; anything unknown or malformed falls back to the default. */
export function parseQuestPageState(params: Params): QuestPageState {
  const view = read(params, "view");
  const trader = read(params, "trader")?.trim();
  const map = read(params, "map");
  const states = new Set((read(params, "status") ?? "").split(","));
  return {
    view: QUEST_VIEWS.find((entry) => entry === view) ?? "list",
    text: (read(params, "q") ?? "").slice(0, MAX_TEXT),
    trader: trader && trader.length <= MAX_TRADER ? trader : null,
    map: map && isItemSlug(map) ? map : null,
    minLevel: level(read(params, "min")),
    maxLevel: level(read(params, "max")),
    kappa: flag(read(params, "kappa")),
    lightkeeper: flag(read(params, "lk")),
    fir: flag(read(params, "fir")),
    states: QUEST_STATES.filter((state) => states.has(state)),
    ownFaction: flag(read(params, "own")),
    scope: read(params, "scope") === "available" ? "available" : "remaining",
    layout: read(params, "layout") === "steps" ? "steps" : "tree",
  };
}

/** The query string for a page state, without the defaults: "" for the default page. */
export function questPageSearch(state: QuestPageState): string {
  const params = new URLSearchParams();
  if (state.view !== "list") params.set("view", state.view);
  if (state.text.trim()) params.set("q", state.text.slice(0, MAX_TEXT));
  if (state.trader) params.set("trader", state.trader);
  if (state.map) params.set("map", state.map);
  if (state.minLevel !== null) params.set("min", String(state.minLevel));
  if (state.maxLevel !== null) params.set("max", String(state.maxLevel));
  if (state.kappa) params.set("kappa", "1");
  if (state.lightkeeper) params.set("lk", "1");
  if (state.fir) params.set("fir", "1");
  if (state.states.length > 0) params.set("status", QUEST_STATES.filter((entry) => state.states.includes(entry)).join(","));
  if (state.ownFaction) params.set("own", "1");
  if (state.scope !== "remaining") params.set("scope", state.scope);
  if (state.layout !== "tree") params.set("layout", state.layout);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * The list filter for a page state. Status and faction filters need the player's progress, so
 * they apply only once it has loaded.
 */
export function questFilter(state: QuestPageState, withProgress: boolean): QuestFilter {
  return {
    text: state.text,
    trader: state.trader,
    map: state.map,
    minLevel: state.minLevel,
    maxLevel: state.maxLevel,
    kappa: state.kappa,
    lightkeeper: state.lightkeeper,
    foundInRaid: state.fir,
    states: withProgress && state.states.length > 0 ? state.states : undefined,
    ownFaction: withProgress && state.ownFaction,
  };
}

/** How many filters narrow the list, the search text aside. */
export function activeFilterCount(state: QuestPageState) {
  return (
    Number(state.trader !== null) +
    Number(state.map !== null) +
    Number(state.minLevel !== null || state.maxLevel !== null) +
    Number(state.kappa) +
    Number(state.lightkeeper) +
    Number(state.fir) +
    Number(state.states.length > 0) +
    Number(state.ownFaction)
  );
}

/** The page state with every filter cleared, keeping the view and its options. */
export function clearedFilters(state: QuestPageState): QuestPageState {
  return { ...DEFAULT_QUEST_PAGE_STATE, view: state.view, scope: state.scope, layout: state.layout };
}
