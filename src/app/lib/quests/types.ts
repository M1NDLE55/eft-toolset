import type { GameMode } from "@/components/game-mode/mode";

export const FACTIONS = ["USEC", "BEAR"] as const;
export type Faction = (typeof FACTIONS)[number];

export function isFaction(value: unknown): value is Faction {
  return value === "USEC" || value === "BEAR";
}

/** What a requirement needs of another quest: any one of these statuses satisfies it. */
export type RequirementStatus = "complete" | "active" | "failed";

export interface QuestRequirement {
  /** The other quest's id. */
  id: string;
  status: RequirementStatus[];
}

/** A map, by tarkov.dev's normalizedName (night-factory, ground-zero-21…). */
export interface QuestMap {
  key: string;
  name: string;
  /** The raid planner and /keys page key for this map, which variants share (night-factory → factory); null without a page. */
  page: string | null;
}

export interface QuestItem {
  name: string;
  shortName: string | null;
  /** The /item/<slug> page, or null when tarkov.dev's slug isn't a valid one. */
  slug: string | null;
  image: string | null;
}

/**
 * Items one objective takes, with the find objectives that collect the same items. It is done
 * once any of its objectives is: handing the items over, or finding them for a later hand-over.
 */
export interface QuestItemNeed {
  objectives: string[];
  /** One item, or alternatives any of which will do; empty when there are too many to list. */
  items: string[];
  count: number;
  foundInRaid: boolean;
  /** For alternatives: what the objective asks for, such as "Hand over any found in raid medicine items". */
  label?: string;
  /** For alternatives: how many items qualify, which can be more than are listed. */
  alternatives?: number;
}

export interface QuestKeys {
  /** A map key, or null when tarkov.dev doesn't say. */
  map: string | null;
  /** Item ids of the keys. */
  keys: string[];
}

export interface QuestSummary {
  id: string;
  name: string;
  /** The /quests/<slug> page; null for a task without a usable slug. See DATA_ARCHITECTURE.md. */
  slug: string | null;
  trader: string | null;
  minPlayerLevel: number;
  /** USEC or BEAR when only that faction gets the quest. */
  faction: Faction | null;
  kappaRequired: boolean;
  lightkeeperRequired: boolean;
  /** Map keys, the quest's own map first. */
  maps: string[];
  requires: QuestRequirement[];
  /** Trader loyalty levels the quest needs before it is given. */
  traderLevels: { trader: string; level: number }[];
  /** Completing any of these quests with the given status fails this one (the other branch of a choice). */
  failedBy: QuestRequirement[];
  /** The prestige level the quest needs, which tells apart quests that share a name (New Beginning). */
  prestige: number | null;
  experience: number;
  /** Items the required objectives take; optional objectives are left out. */
  needs: QuestItemNeed[];
  keys: QuestKeys[];
  /** Required objective ids, in order. */
  objectives: string[];
  optionalObjectives: string[];
  image: string | null;
}

export interface QuestList {
  quests: QuestSummary[];
  /** Every item the quests' needs and keys reference. */
  items: Record<string, QuestItem>;
  maps: Record<string, QuestMap>;
  /** Traders that give quests, in the game's order. */
  traders: string[];
}

export interface PricedQuestItem extends QuestItem {
  /** The cheapest way to buy it: a trader's offer or the flea market's 24-hour average. */
  buy: { price: number; vendor: string } | null;
  /** The best sell price, after the flea fee. */
  sell: { price: number; vendor: string } | null;
}

export interface QuestObjective {
  id: string;
  type: string | null;
  description: string;
  count: number | null;
  foundInRaid: boolean;
  optional: boolean;
  maps: string[];
  /** Item ids the objective names; alternatives when there are several. Capped, see `alternatives`. */
  items: string[];
  /** How many items qualify, which can be more than are listed. */
  alternatives: number;
  /** A quest-only item to find, hand over or plant. */
  questItem: { name: string; image: string | null } | null;
  /** Keys it needs: every group, any one key of each group. */
  requiredKeys: string[][];
}

export interface QuestRewards {
  items: { id: string; count: number }[];
  traderStanding: { trader: string; standing: number }[];
  offerUnlocks: { id: string; trader: string; level: number | null }[];
  skills: { name: string; level: number }[];
  traderUnlocks: string[];
  craftUnlocks: { id: string; count: number; station: string; level: number | null }[];
}

export interface QuestRef {
  id: string;
  name: string;
  slug: string | null;
  trader: string | null;
  minPlayerLevel: number;
  faction: Faction | null;
}

export interface QuestDetail {
  gameMode: GameMode;
  quest: QuestSummary;
  wikiLink: string | null;
  restartable: boolean;
  objectives: QuestObjective[];
  /** Given on completion. Experience is in `quest.experience`. */
  rewards: QuestRewards;
  /** Given when the quest is accepted. */
  startRewards: QuestRewards;
  /** The quest's direct requirements: `quest.requires`. */
  prerequisites: QuestRequirement[];
  /** Quests that list this one as a requirement, with the status they need of it. */
  unlocks: QuestRequirement[];
  chain: {
    /** Every quest to complete or start first, prerequisites first; failure branches are left out. */
    before: string[];
    /** Every quest that follows from this one, nearest first. */
    after: string[];
  };
  /** Every quest the fields above mention, and this one. */
  quests: Record<string, QuestRef>;
  /** Every item the objectives, keys and rewards mention, priced. */
  items: Record<string, PricedQuestItem>;
  maps: Record<string, QuestMap>;
}

/** One game mode's progress, as the progress store keeps it. */
export interface QuestProgress {
  completed: string[];
  /** Objectives marked done; kept when their quest is completed, so un-completing it loses nothing. */
  objectives: string[];
  /** Null until the player sets it: then level requirements aren't checked. */
  level: number | null;
  /** Null until the player sets it: then quests for either faction are shown. */
  faction: Faction | null;
}
