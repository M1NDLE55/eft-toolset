import { itemIndexing, type IndexableItem, type ItemIndexing } from "@/app/lib/seo/item-index";
import type { GameMode } from "@/components/game-mode/context";
import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedHideoutRequirement,
  CachedHideoutSlot,
  CachedItem,
  CachedTask,
  CachedVendorPrice,
  CatalogEntry,
  ComposedItem,
  MarketBoard,
  MarketRow,
  ItemUses,
  CachedItemInfo,
  CachedKeyInfo,
} from "@/app/lib/cache/types";
import type {
  AmmoItemData,
  BarterOffer,
  BuildItemData,
  GunListItem,
  ModSlotDef,
  PickItemData,
  PresetContents,
  SightKind,
  TaskUnlock,
  TraderOffer,
} from "@/app/lib/types/gunBuilder";
import type { TaskIndex, TaskNode } from "@/app/lib/builds/quests";
import { chainAfter, chainBefore, questGraph } from "@/app/lib/quests/graph";
import { mapPageKey } from "@/app/lib/quests/maps";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { infoboxFact } from "@/app/lib/wiki/item-wiki";
import { findItemWikiPage } from "@/app/lib/wiki/snapshot";
import {
  isFaction,
  type Faction,
  type PricedQuestItem,
  type QuestDetail,
  type QuestItem,
  type QuestItemNeed,
  type QuestKeys,
  type QuestList,
  type QuestMap,
  type QuestObjective,
  type QuestObjectiveCondition,
  type QuestRef,
  type QuestRequirement,
  type QuestRewards,
  type QuestSummary,
  type RequirementStatus,
} from "@/app/lib/quests/types";
import { isItemSlug } from "@/app/lib/item-links";
import { barterCost } from "@/app/lib/builds/price";
import { bestSell, FLEA_MARKET } from "@/app/lib/item-price";
import type {
  ExtractFaction,
  MapBoss,
  MapDetails,
  MapSpawn,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import { orderQuests, orderTraders } from "@/app/lib/quests/order";
import { TARKOV_OPERATIONS, type TarkovOperation } from "./operations";
import { regionalCache } from "./shared-cache";
import { readSnapshot } from "./tarkov-snapshot";
import { USER_AGENT } from "./user-agent";
import { AsyncLocalStorage } from "node:async_hooks";

// TARKOV_UPSTREAM_URL points a local build at a stand-in upstream (scripts/mcp-load.mjs); never on Vercel.
const UPSTREAM_BASE_URL = (!process.env.VERCEL && process.env.TARKOV_UPSTREAM_URL?.replace(/\/+$/, "")) || "https://json.tarkov.dev";
// tarkov.dev answers in well under a second; a request still going after this won't help.
const UPSTREAM_TIMEOUT_MS = 12_000;
const UPSTREAM_MAX_BYTES = 32 * 1024 * 1024;
const MAX_UPSTREAM_REQUESTS = 4;
/**
 * Requests per refresh for a caller with no copy at all: quick failures (a reset connection, a 5xx)
 * are tried again after a short wait. Refreshes of a copy make one request; the copy is served if it fails.
 */
const UPSTREAM_ATTEMPTS = 3;
const UPSTREAM_RETRY_DELAYS_MS = [250, 1_000];
/** A 429 asking for a longer wait than this ends the refresh instead of being waited out. */
const UPSTREAM_RETRY_AFTER_WAIT_MS = 2_000;
// After a refresh fails, the dataset isn't requested again for a while (doubling up to the max),
// so a tarkov.dev outage costs one request per dataset per wait (about ten an hour). Callers holding
// a copy get the copy meanwhile; only a caller with no copy at all gets an error, with the time left
// as retryAfter.
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 10 * 60_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;
/** The wait to report for a dataset still being tried: its retries, then the longest first wait. */
const UNSETTLED_WAIT_MS = 1.5 * UPSTREAM_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + 1.2 * RETRY_BASE_MS;
/** How long an MCP tool holding a stale copy waits for its refresh before taking the copy (see staleWaitMs). */
export const MCP_STALE_WAIT_MS = 2_500;
/** The oldest copy a read accepts when tarkov.dev can't be reached, unless the read asks otherwise. */
export const RESOURCE_MAX_STALE_MS = 6 * 60 * 60_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// Runtime Cache items are capped at 2 MB.
const SHARED_MAX_CHARS = 1_000_000;
const SHARED_KEY_VERSION = 1;
// A 304 renews the shared record, not the body.
const SHARED_BODY_TTL_SECONDS = 24 * 60 * 60;
const MAX_RESOURCE_RECORDS = 100_000;
const MAX_NESTED_ENTRIES = 20_000;
const MAX_STRING_LENGTH = 10_000;
const MAX_OBJECTIVE_NODES = 10_000;
// tarkov.dev expands "any item" objectives (e.g. "Sell any items to Prapor") into
// every eligible item: 3,000+ IDs. The largest real category objective is ~110.
const MAX_ITEM_SPECIFIC_OBJECTIVE_IDS = 1_000;
const MAX_NAMES = 100;
const MAX_IDS = 100;

type Resource =
  | "items"
  | "items_en"
  | "tasks"
  | "tasks_en"
  | "traders"
  | "traders_en"
  | "barters"
  | "crafts"
  | "hideout"
  | "hideout_en"
  | "maps"
  | "maps_en";

interface ResourcePolicy {
  freshMs: number;
  /** Until this age a stale copy is served while it refreshes; after it, callers wait. */
  revalidateMs: number;
  shared: boolean;
}

const RESOURCE_POLICIES: Record<Resource, ResourcePolicy> = {
  // Prices change every 5 to 10 minutes. 17 MB.
  items: { freshMs: 5 * MINUTE_MS, revalidateMs: 30 * MINUTE_MS, shared: false },
  // 9 MB and 2 MB.
  maps: { freshMs: 30 * MINUTE_MS, revalidateMs: 2 * HOUR_MS, shared: false },
  tasks: { freshMs: 30 * MINUTE_MS, revalidateMs: 2 * HOUR_MS, shared: false },
  // 1.7 MB: too close to the shared limit.
  items_en: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: false },
  // Under 300 KB each; barters change every two hours, the rest with patches.
  barters: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  crafts: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  hideout: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  hideout_en: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  maps_en: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  tasks_en: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  traders: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
  traders_en: { freshMs: 2 * HOUR_MS, revalidateMs: 4 * HOUR_MS, shared: true },
};

type Dictionary<T> = Record<string, T>;
type TranslationDictionary = Dictionary<string>;

interface UpstreamEnvelope<T> {
  data: T;
}

interface RawContainedItem {
  item?: string;
  count?: number;
  attributes?: { tool?: boolean | null } | null;
}

interface RawTraderOffer {
  trader?: string;
  priceRUB?: number | null;
  minTraderLevel?: number | null;
  /** Buy offers only: the task that unlocks the offer. */
  taskUnlock?: string | null;
}

interface RawSlot {
  id?: string;
  name?: string;
  nameId?: string;
  required?: boolean;
  filters?: {
    allowedItems?: string[];
  };
}

interface RawItemProperties {
  propertiesType?: string;
  caliber?: string | null;
  ergonomics?: number | null;
  recoilModifier?: number | null;
  recoilVertical?: number | null;
  recoilHorizontal?: number | null;
  fireRate?: number | null;
  fireModes?: string[] | null;
  defaultAmmo?: string | null;
  defaultPreset?: string | null;
  defaultWidth?: number | null;
  defaultHeight?: number | null;
  presets?: string[] | null;
  slots?: RawSlot[] | null;
  baseItem?: string | null;
  capacity?: number | null;
  allowedAmmo?: string[] | null;
  damage?: number | null;
  armorDamage?: number | null;
  penetrationPower?: number | null;
  fragmentationChance?: number | null;
  projectileCount?: number | null;
  initialSpeed?: number | null;
  accuracyModifier?: number | null;
  /** Sights and weapons: how far the sight can be zeroed, in metres. */
  sightingRange?: number | null;
}

interface RawItem {
  id?: string;
  normalizedName?: string;
  name?: string;
  shortName?: string | null;
  gridImageLink?: string | null;
  wikiLink?: string | null;
  fleaMarketFee?: number | null;
  minLevelForFlea?: number | null;
  width?: number | null;
  height?: number | null;
  weight?: number | null;
  basePrice?: number | null;
  lastLowPrice?: number | null;
  avg24hPrice?: number | null;
  low24hPrice?: number | null;
  high24hPrice?: number | null;
  lastOfferCount?: number | null;
  stackMaxSize?: number | null;
  /** A translation key, like name. */
  description?: string | null;
  changeLast48hPercent?: number | null;
  types?: string[] | null;
  categories?: string[] | null;
  handbookCategories?: string[] | null;
  /** When tarkov.dev last updated the item's data (its prices, mostly), as an ISO time. */
  updated?: string | null;
  buyFromTrader?: RawTraderOffer[] | null;
  sellToTrader?: RawTraderOffer[] | null;
  conflictingItems?: string[] | null;
  conflictingSlotIds?: string[] | null;
  properties?: RawItemProperties | null;
  containsItems?: RawContainedItem[] | null;
}

interface RawTaskObjective {
  id?: string | null;
  description?: string | null;
  type?: string | null;
  count?: number | null;
  foundInRaid?: boolean | null;
  optional?: boolean | null;
  item?: string | null;
  items?: string[] | null;
  markerItem?: string | null;
  containsAll?: unknown;
  containsOne?: unknown;
  wearing?: unknown;
  usingWeapon?: unknown;
  usingWeaponMods?: unknown;
  notWearing?: unknown;
  /** buildWeapon objectives: item categories the build must contain one of each. */
  containsCategory?: unknown;
  /** buildWeapon objectives: stat requirements, such as {ergonomics: {compareMethod: ">=", value: 40}}. */
  buildAttributes?: unknown;
  /** Map ids. */
  maps?: string[] | null;
  /** Keys the objective needs: every group, any one key of each. */
  requiredKeys?: string[][] | null;
  /** findQuestItem, giveQuestItem, and plantQuestItem objectives: an id in the tasks data's questItems. */
  questItem?: string | null;
  /** useItem objectives: items any of which can be used. */
  useAny?: string[] | null;
  /** taskStatus objectives and fail conditions: the other task and the statuses that count. */
  task?: string | null;
  status?: string[] | null;
}

interface RawTaskRewards {
  traderStanding?: { trader?: string | null; standing?: number | null }[] | null;
  items?: RawContainedItem[] | null;
  offerUnlock?: { trader?: string | null; level?: number | null; item?: string | null }[] | null;
  skillLevelReward?: { skill?: string | null; level?: number | null }[] | null;
  /** Trader ids. */
  traderUnlock?: string[] | null;
  craftUnlock?: { station?: string | null; level?: number | null; item?: string | null; count?: number | null }[] | null;
}

interface RawQuestItem {
  name?: string | null;
  shortName?: string | null;
  gridImageLink?: string | null;
}

interface RawTask {
  id?: string;
  name?: string;
  normalizedName?: string;
  minPlayerLevel?: number | null;
  wikiLink?: string | null;
  trader?: string | null;
  factionName?: string | null;
  objectives?: RawTaskObjective[] | null;
  /** Tasks this one needs, and the statuses (complete, active, failed) that satisfy each. */
  taskRequirements?: { task?: string | null; status?: string[] | null }[] | null;
  traderRequirements?: {
    trader?: string | null;
    requirementType?: string | null;
    compareMethod?: string | null;
    value?: number | null;
  }[] | null;
  experience?: number | null;
  kappaRequired?: boolean | null;
  lightkeeperRequired?: boolean | null;
  restartable?: boolean | null;
  taskImageLink?: string | null;
  /** The task's map id, when it has one. */
  map?: string | null;
  neededKeys?: { map?: string | null; keys?: string[] | null }[] | null;
  failConditions?: RawTaskObjective[] | null;
  startRewards?: RawTaskRewards | null;
  finishRewards?: RawTaskRewards | null;
  /** The id of a prestige the task needs, in the tasks data's prestige list. */
  requiredPrestige?: string | null;
}

interface RawBarter {
  trader?: string;
  taskUnlock?: string | null;
  minTraderLevel?: number | null;
  requiredItems?: RawContainedItem[] | null;
  offeredItem?: RawContainedItem | null;
}

interface RawCraft {
  station?: string;
  taskUnlock?: string | null;
  level?: number | null;
  requiredItems?: RawContainedItem[] | null;
  productItem?: RawContainedItem | null;
}

interface RawNamedEntity {
  id?: string;
  name?: string;
  normalizedName?: string;
}

interface RawHideoutStation extends RawNamedEntity {
  levels?: {
    level?: number | null;
    itemRequirements?: {
      item?: string | null;
      count?: number | null;
      attributes?: { foundInRaid?: boolean | null } | null;
    }[] | null;
    bonuses?: { type?: string | null; value?: number | null; slotItems?: string[] | null }[] | null;
  }[] | null;
}

interface RawPosition {
  x: number;
  y: number;
  z: number;
}

interface RawMap {
  normalizedName?: string;
  name?: string;
  players?: string | null;
  raidDuration?: number | null;
  extracts?: {
    id?: string;
    name?: string | null;
    faction?: string | null;
    position?: RawPosition | null;
    outline?: { x: number; z: number }[] | null;
    top?: number | null;
    bottom?: number | null;
    transferItem?: { item?: unknown; count?: unknown } | null;
  }[];
  transits?: {
    id?: string;
    description?: string | null;
    conditions?: string | null;
    position?: RawPosition | null;
    outline?: { x: number; z: number }[] | null;
    top?: number | null;
    bottom?: number | null;
  }[];
  spawns?: {
    zoneName?: string | null;
    position?: RawPosition | null;
    sides?: string[] | null;
    categories?: string[] | null;
  }[];
  locks?: {
    lockType?: string | null;
    needsPower?: boolean | null;
    position?: RawPosition | null;
    key?: string | null;
  }[];
  hazards?: {
    name?: string | null;
    hazardType?: string | null;
    position?: RawPosition | null;
    outline?: { x: number; z: number }[] | null;
    top?: number | null;
    bottom?: number | null;
  }[];
  lootContainers?: {
    position?: RawPosition | null;
    lootContainer?: string | null;
  }[];
  switches?: {
    id?: string;
    name?: string | null;
    position?: RawPosition | null;
  }[];
  stationaryWeapons?: {
    position?: RawPosition | null;
    stationaryWeapon?: string | null;
  }[];
  // Read defensively in projectBosses, so a format change drops bosses rather than the map.
  bosses?: Record<string, unknown>[];
}

interface RawCategory {
  name?: string;
  normalizedName?: string;
  parent?: string | null;
}

interface ItemsData {
  items?: Dictionary<RawItem>;
  itemCategories?: Dictionary<RawCategory>;
  handbookCategories?: Dictionary<RawCategory>;
  fleaMarket?: {
    sellOfferFeeRate?: number | null;
    sellRequirementFeeRate?: number | null;
  };
}

interface TasksData {
  tasks?: Dictionary<RawTask>;
  questItems?: Dictionary<RawQuestItem>;
  prestige?: { id?: string | null; prestigeLevel?: number | null }[] | null;
}

interface MapsData {
  maps?: Dictionary<RawMap>;
  lootContainers?: Dictionary<RawNamedEntity>;
  stationaryWeapons?: Dictionary<RawNamedEntity>;
  mobs?: Record<string, unknown>;
}

interface ResourceCacheEntry {
  /** Last confirmed with tarkov.dev, here, by another instance, or by the build (source "deployment"). */
  fetchedAt: number;
  value?: UpstreamEnvelope<unknown>;
  /** Where value came from: tarkov.dev (directly or through the shared cache), or the deployment's snapshot. */
  source?: DataSource;
  etag?: string;
  lastModified?: string;
  inFlight?: Promise<UpstreamEnvelope<unknown>>;
  /** Reading the deployment's snapshot: started once per entry. */
  seed?: Promise<void>;
  /** A caller gave up waiting for the refresh in flight, so later ones don't wait for it either. */
  slowRefresh?: boolean;
  failedAt?: number;
  failures?: number;
  retryAt?: number;
  lastError?: string;
}

export type DataSource = "tarkov.dev" | "deployment";

interface Refreshed {
  value: UpstreamEnvelope<unknown>;
  etag?: string;
  lastModified?: string;
  checkedAt: number;
}

interface SharedMeta {
  etag?: string;
  lastModified?: string;
  checkedAt: number;
}

interface ItemsContext {
  items: RawItem[];
  byId: Map<string, RawItem>;
  byName: Map<string, RawItem>;
  bySlug: Map<string, RawItem>;
  nameById: Map<string, string>;
  translations: TranslationDictionary;
  fleaMarket?: ItemsData["fleaMarket"];
  /** Item category id to its English name. */
  categoryNames: Map<string, string>;
}

interface TasksContext {
  tasks: RawTask[];
  byId: Map<string, RawTask>;
  byItem: Map<string, TaskItemUse[]>;
  questItems: Dictionary<RawQuestItem>;
  /** Prestige id to its level. */
  prestigeLevels: Map<string, number>;
  translations: TranslationDictionary;
}

interface TaskItemUse {
  task: RawTask;
  /** The task's objectives that involve the indexed item. */
  objectives: RawTaskObjective[];
}

interface HideoutContext {
  stationNames: Map<string, string>;
  requirementsByItem: Map<string, CachedHideoutRequirement[]>;
  slotsByItem: Map<string, CachedHideoutSlot[]>;
}

interface RelationsContext {
  bartersByItem: Map<string, RawBarter[]>;
  bartersByReward: Map<string, RawBarter[]>;
  craftsByItem: Map<string, RawCraft[]>;
  craftsByReward: Map<string, RawCraft[]>;
}

interface OfferContext {
  traderNames: Map<string, string>;
  itemById: Map<string, RawItem>;
  translations: TranslationDictionary;
  taskUnlock: (taskId: string | null | undefined) => TaskUnlock | null;
  bartersByReward?: Map<string, RawBarter[]>;
}

interface MemoEntry {
  inputs: readonly unknown[];
  value: unknown;
}

export class TarkovUpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** When asking again could succeed: tarkov.dev's Retry-After, or the time left before the next refresh. */
    readonly retryAfterMs?: number,
    /** A bad payload rather than a failed request: asking again right away won't help. */
    readonly permanent = false,
    /** The request ran out of time: tarkov.dev is slow, so it isn't asked again within the refresh. */
    readonly timedOut = false
  ) {
    super(message);
    this.name = "TarkovUpstreamError";
  }

  // This module is bundled into several server chunks that share one resource cache through
  // globalThis, so a refresh started by one chunk (the boot-time warm-up, say) rejects with another
  // copy of this class. Recognise every copy by name, so instanceof works wherever the error lands.
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof Error && value.name === "TarkovUpstreamError";
  }
}

export class TarkovRequestError extends Error {
  constructor(message: string, readonly code = "INVALID_REQUEST") {
    super(message);
    this.name = "TarkovRequestError";
  }
}

const CACHE_KEY = "__eftTarkovCache:2";
const sharedCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: { resources: Map<string, ResourceCacheEntry>; memos: Map<string, MemoEntry> };
};
sharedCache[CACHE_KEY] ??= { resources: new Map(), memos: new Map() };
const resourceCache = sharedCache[CACHE_KEY].resources;
const memoCache = sharedCache[CACHE_KEY].memos;
/** A copy a read used, with when it was confirmed and where it came from at the time. */
interface UsedCopy {
  entry: ResourceCacheEntry;
  value: unknown;
  fetchedAt: number;
  source: DataSource;
  /** Its refresh had failed, or didn't arrive within the read's wait. */
  stale: boolean;
}

const operationContext = new AsyncLocalStorage<{
  resources: Set<ResourceCacheEntry>;
  used: Map<string, UsedCopy>;
  maxStaleMs: number;
  staleWaitMs: number;
  signal?: AbortSignal;
}>();
/** Stands in for a dataset a read saw two different copies of, so its snapshot never matches. */
const MIXED_COPIES = Symbol("mixed copies");

const MAX_CONCURRENT_OPERATIONS = 16;
let activeOperations = 0;

export function tryAcquireOperationSlot() {
  if (activeOperations >= MAX_CONCURRENT_OPERATIONS) return false;
  activeOperations += 1;
  return true;
}

export function releaseOperationSlot() {
  activeOperations = Math.max(0, activeOperations - 1);
  grantRenderSlots();
}

// Page renders queue for a slot instead of giving up: a cached page waits for its data. They hold
// at most RENDER_SLOTS at once, so /api/tarkov and MCP, which take a slot or answer busy, always
// have some left.
const RENDER_SLOTS = 12;
let activeRenders = 0;
const renderWaiters: Array<() => boolean> = [];

function tryAcquireRenderSlot() {
  if (activeRenders >= RENDER_SLOTS || !tryAcquireOperationSlot()) return false;
  activeRenders += 1;
  return true;
}

function grantRenderSlots() {
  while (renderWaiters.length > 0 && tryAcquireRenderSlot()) renderWaiters.shift()!();
}

/** Waits for a render slot; release it with `releaseRenderSlot`. Rejects when the signal aborts first. */
export function waitForRenderSlot(signal: AbortSignal): Promise<void> {
  if (tryAcquireRenderSlot()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const grant = () => {
      signal.removeEventListener("abort", abort);
      resolve();
      return true;
    };
    const abort = () => {
      const index = renderWaiters.indexOf(grant);
      if (index >= 0) renderWaiters.splice(index, 1);
      reject(signal.reason);
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    renderWaiters.push(grant);
  });
}

export function releaseRenderSlot() {
  activeRenders = Math.max(0, activeRenders - 1);
  releaseOperationSlot();
}

const OPERATION_VARIABLES: Record<TarkovOperation, readonly string[]> = {
  [TARKOV_OPERATIONS.itemCatalog]: ["gameMode"],
  [TARKOV_OPERATIONS.groupItems]: ["gameMode", "names"],
  [TARKOV_OPERATIONS.itemDetail]: ["gameMode", "name", "slug"],
  [TARKOV_OPERATIONS.gunList]: ["gameMode"],
  [TARKOV_OPERATIONS.buildItems]: ["gameMode", "ids"],
  [TARKOV_OPERATIONS.pickItems]: ["gameMode", "ids"],
  [TARKOV_OPERATIONS.preset]: ["gameMode", "id"],
  [TARKOV_OPERATIONS.ammoItems]: ["gameMode", "ids"],
  [TARKOV_OPERATIONS.mapDetails]: ["gameMode", "mapKey"],
  [TARKOV_OPERATIONS.marketBoard]: ["gameMode"],
  [TARKOV_OPERATIONS.questList]: ["gameMode"],
};

export interface TarkovReadOptions {
  signal?: AbortSignal;
  /**
   * The oldest copy to take when tarkov.dev can't be reached in time (default RESOURCE_MAX_STALE_MS).
   * Cached pages keep the default, so a failed background render keeps the previous page rather
   * than caching older data; MCP tools take any copy and say how old it is.
   */
  maxStaleMs?: number;
  /**
   * How long to wait for a due refresh before taking the copy in hand (default: until the refresh
   * ends). Page renders wait, so they don't cache an older copy when tarkov.dev is merely slow; MCP
   * tools wait MCP_STALE_WAIT_MS and say the data is stale.
   */
  staleWaitMs?: number;
  /** Called when the result was built from a copy whose refresh failed or didn't finish in time. */
  onStale?: (info: { source: DataSource }) => void;
  onDataAge?: (ageMs: number) => void;
  onSnapshot?: (snapshot: DataSnapshot) => void;
}

export type DataSnapshot = ReadonlyArray<readonly [key: string, entry: object, value: unknown]>;

/** Whether a result built from these copies can stand in for a fresh read. Due datasets start refreshing, as in a read. */
export function canReuseSnapshot(snapshot: DataSnapshot) {
  if (snapshot.length === 0) return false;
  const now = Date.now();
  const due: [string, ResourceCacheEntry][] = [];
  for (const [key, entry, value] of snapshot) {
    const current = resourceCache.get(key);
    if (current !== entry || current.value !== value || current.failedAt !== undefined) return false;
    const policy = RESOURCE_POLICIES[resourceOf(key)];
    if (now - current.fetchedAt >= policy.revalidateMs) return false;
    if (now - current.fetchedAt >= policy.freshMs) due.push([key, current]);
  }
  for (const [key, entry] of due) {
    const [gameMode] = key.split("/") as [GameMode];
    void refreshResource(gameMode, resourceOf(key), entry).catch(() => undefined);
  }
  return true;
}

function resourceOf(key: string) {
  return key.slice(key.indexOf("/") + 1) as Resource;
}

// Track cancellation and freshness for server-side reads.
export async function runTarkovRead<T>(
  work: () => Promise<T>,
  options: TarkovReadOptions = {}
): Promise<T> {
  const context = {
    resources: new Set<ResourceCacheEntry>(),
    used: new Map<string, UsedCopy>(),
    maxStaleMs: options.maxStaleMs ?? RESOURCE_MAX_STALE_MS,
    staleWaitMs: options.staleWaitMs ?? Number.POSITIVE_INFINITY,
    signal: options.signal,
  };
  return operationContext.run(context, async () => {
    options.signal?.throwIfAborted();
    const data = await waitForCaller(work(), options.signal).catch((error: unknown) => {
      throw error instanceof TarkovUpstreamError ? withLongestWait(error, context.resources, context.maxStaleMs) : error;
    });
    // From the copies the read used, not the entries now: a refresh may have landed since.
    const used = Array.from(context.used.values());
    const stale = used.filter((copy) => copy.stale || copy.entry.failedAt !== undefined);
    if (stale.length > 0) {
      options.onStale?.({ source: stale.some((copy) => copy.source === "deployment") ? "deployment" : "tarkov.dev" });
    }
    const oldest = Math.min(...used.map((copy) => copy.fetchedAt));
    if (Number.isFinite(oldest)) options.onDataAge?.(Math.max(0, Date.now() - oldest));
    options.onSnapshot?.(Array.from(context.used, ([key, { entry, value }]) => [key, entry, value] as const));
    return data;
  });
}

/**
 * A read fails as soon as one dataset does, while others may still be failing or about to; retrying
 * after the first one's wait would only meet the next. So the error carries the longest wait.
 */
function withLongestWait(error: TarkovUpstreamError, entries: Iterable<ResourceCacheEntry>, maxStaleMs: number) {
  const now = Date.now();
  let waitMs = error.retryAfterMs ?? 0;
  for (const entry of entries) {
    // Datasets the read had a copy of didn't make it fail.
    if (entry.value && now - entry.fetchedAt < maxStaleMs) continue;
    if (entry.retryAt !== undefined) waitMs = Math.max(waitMs, entry.retryAt - now);
    // Still trying with nothing to fall back on: it may fail and start a wait of its own.
    else if (entry.inFlight) waitMs = Math.max(waitMs, UNSETTLED_WAIT_MS);
  }
  return waitMs === error.retryAfterMs
    ? error
    : new TarkovUpstreamError(error.message, error.status, waitMs, error.permanent, error.timedOut);
}

export async function executeTarkovOperation(
  operation: TarkovOperation,
  variables: unknown,
  options: TarkovReadOptions = {}
): Promise<unknown> {
  const allowed = OPERATION_VARIABLES[operation];
  if (!allowed) throw new TarkovRequestError("Unknown query operation.", "INVALID_OPERATION");
  const input = asRecord(variables);
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new TarkovRequestError("Variables contain unsupported fields.");
  }
  const gameMode = readGameMode(input);
  return runTarkovRead<unknown>(() => {
    switch (operation) {
      case TARKOV_OPERATIONS.itemCatalog:
        return getItemCatalog(gameMode);
      case TARKOV_OPERATIONS.groupItems:
        return getGroupItems(gameMode, readStringList(input.names, "names", MAX_NAMES));
      case TARKOV_OPERATIONS.itemDetail:
        return getItemDetail(gameMode, readItemReference(input));
      case TARKOV_OPERATIONS.gunList:
        return getGunList(gameMode);
      case TARKOV_OPERATIONS.buildItems:
        return getBuildItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
      case TARKOV_OPERATIONS.pickItems:
        return getPickItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
      case TARKOV_OPERATIONS.ammoItems:
        return getAmmoItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
      case TARKOV_OPERATIONS.preset:
        return getPreset(gameMode, readString(input.id, "id", 80));
      case TARKOV_OPERATIONS.mapDetails:
        return getMapDetails(gameMode, readString(input.mapKey, "mapKey", 80));
      case TARKOV_OPERATIONS.marketBoard:
        return getMarketBoard(gameMode);
      case TARKOV_OPERATIONS.questList:
        return getQuestList(gameMode);
    }
  }, options);
}

function waitForCaller<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function throwIfRequestAborted() {
  operationContext.getStore()?.signal?.throwIfAborted();
}

function memo<T>(key: string, inputs: readonly unknown[], compute: () => T): T {
  const cached = memoCache.get(key);
  if (
    cached &&
    cached.inputs.length === inputs.length &&
    cached.inputs.every((input, index) => input === inputs[index])
  ) {
    return cached.value as T;
  }
  const value = compute();
  memoCache.set(key, { inputs, value });
  return value;
}

export async function getItemCatalog(gameMode: GameMode): Promise<CatalogEntry[]> {
  const context = await loadItems(gameMode);
  return memo(`${gameMode}/catalog`, [context], () =>
    projectItemCatalog(context.items, context.translations)
  );
}

export interface ItemFacet {
  /** tarkov.dev item types, such as "ammo", "keys", or "injectors". */
  types: string[];
  /** Lower-case names and slugs of the item's handbook and item categories and their parents. */
  categories: string[];
  /** Ammo caliber as tarkov.dev names it, such as "Caliber556x45NATO". */
  caliber: string | null;
}

export interface ItemFacets {
  byId: ReadonlyMap<string, ItemFacet>;
  /** Handbook category names: the tree the trader and flea market screens use. */
  categoryNames: string[];
  /** The game's own item category names, such as "Stimulant" or "Keycard". */
  itemCategoryNames: string[];
}

/** Types, categories, and calibers per item id, for filtering item lists. */
export async function getItemFacets(gameMode: GameMode): Promise<ItemFacets> {
  const [itemsEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<ItemsData>(gameMode, "items"),
    loadResource<TranslationDictionary>(gameMode, "items_en"),
  ]);
  return memo(`${gameMode}/facets`, [itemsEnvelope, translationsEnvelope], () => {
    const translations = translationsEnvelope.data;
    const trees = [itemsEnvelope.data.handbookCategories ?? {}, itemsEnvelope.data.itemCategories ?? {}];
    const labels = (tree: Dictionary<RawCategory>, id: string) => {
      const keys: string[] = [];
      const seen = new Set<string>();
      for (let current: string | null | undefined = id; current && !seen.has(current); current = tree[current]?.parent) {
        seen.add(current);
        const category = tree[current];
        if (!category) break;
        const name = translate(category.name, translations).toLocaleLowerCase();
        if (name) keys.push(name);
        if (category.normalizedName) keys.push(category.normalizedName);
      }
      return keys;
    };
    const byId = new Map<string, ItemFacet>();
    for (const item of Object.values(itemsEnvelope.data.items ?? {})) {
      if (!item.id) continue;
      const categories = new Set([
        ...(item.handbookCategories ?? []).flatMap((id) => labels(trees[0], id)),
        ...(item.categories ?? []).flatMap((id) => labels(trees[1], id)),
      ]);
      byId.set(item.id, {
        types: item.types ?? [],
        categories: [...categories],
        caliber: item.properties?.caliber ?? null,
      });
    }
    const names = (tree: Dictionary<RawCategory>) =>
      Array.from(new Set(Object.values(tree).map((category) => translate(category.name, translations)))).filter(Boolean);
    return { byId, categoryNames: names(trees[0]), itemCategoryNames: names(trees[1]) };
  });
}

export async function getGroupItems(gameMode: GameMode, names: string[]): Promise<CachedItem[]> {
  if (names.length === 0) return [];
  const [itemContext, offers, taskContext] = await Promise.all([
    loadItems(gameMode),
    loadOfferContext(gameMode),
    loadTasks(gameMode),
  ]);
  throwIfRequestAborted();
  return names.flatMap((name) => {
    const item = itemContext.byName.get(name);
    if (!item) return [];
    const usedInTasks = (taskContext.byItem.get(item.id ?? "") ?? []).map(({ task }) => ({
      name: translate(task.name, taskContext.translations),
    }));
    return [projectCachedItem(item, name, offers, usedInTasks, itemContext.fleaMarket)];
  });
}

export interface PriceHighlight {
  name: string;
  shortName: string | null;
  normalizedName: string;
  gridImageLink: string | null;
  /** Best sell price: the flea price after its fee, or the best trader's. */
  price: number;
  vendor: string;
  flea: boolean;
  slots: number;
  perSlot: number;
  changeLast48hPercent: number | null;
}

export interface PriceHighlights {
  byPerSlot: PriceHighlight[];
  byPrice: PriceHighlight[];
  keys: PriceHighlight[];
}

const HIGHLIGHT_EXCLUDED_TYPES = new Set(["preset", "gun"]);

/** The most valuable loot, for the item prices page: best per slot, best overall, and keys. */
export async function getPriceHighlights(gameMode: GameMode, limit = 30): Promise<PriceHighlights> {
  const [itemContext, offers] = await Promise.all([loadItems(gameMode), loadOfferContext(gameMode)]);
  throwIfRequestAborted();
  const all = memo(`${gameMode}/price-highlights`, [itemContext, offers], () =>
    itemContext.items.flatMap((item): (PriceHighlight & { key: boolean })[] => {
      const types = item.types ?? [];
      if (!item.id || !item.normalizedName || types.some((type) => HIGHLIGHT_EXCLUDED_TYPES.has(type))) return [];
      if (!/^[a-z0-9][a-z0-9-]*$/.test(item.normalizedName)) return [];
      const name = translate(item.name, itemContext.translations);
      if (!name) return [];
      const projected = projectCachedItem(item, name, offers, [], itemContext.fleaMarket);
      const best = bestSell(projected);
      if (!best) return [];
      const slots = projected.width * projected.height;
      return [{
        name,
        shortName: projected.shortName,
        normalizedName: projected.normalizedName,
        gridImageLink: projected.gridImageLink,
        price: best.price,
        vendor: best.vendor,
        flea: best.flea,
        slots,
        perSlot: Math.round(best.price / slots),
        changeLast48hPercent: projected.changeLast48hPercent,
        key: types.includes("keys"),
      }];
    })
  );
  const top = (rows: typeof all, by: (row: PriceHighlight) => number) =>
    rows
      .toSorted((a, b) => by(b) - by(a))
      .slice(0, limit)
      .map(({ key: _key, ...row }) => row);
  return {
    byPerSlot: top(all.filter((row) => !row.key), (row) => row.perSlot),
    byPrice: top(all, (row) => row.price),
    keys: top(all.filter((row) => row.key), (row) => row.price),
  };
}

const MARKET_ROWS = 8;
/** Movers below this flea price are left out: cheap items swing by large percentages on a few listings. */
const MARKET_MIN_PRICE = 10_000;
/** Larger 48-hour swings are nearly always a thinly traded item with one odd listing, so they are left out. */
const MARKET_MAX_MOVE_PERCENT = 60;
/**
 * Movers are limited to loot that trades in volume. Weapon parts, keys and ammo packs have so few
 * listings that their 48-hour change mostly reflects one seller.
 */
const MARKET_MOVER_TYPES = new Set(["barter", "provisions", "meds", "injectors", "container"]);

/** The biggest 48-hour flea movers and the best sell value per slot, across every item. */
export async function getMarketBoard(gameMode: GameMode): Promise<MarketBoard> {
  const [itemContext, offers] = await Promise.all([loadItems(gameMode), loadOfferContext(gameMode)]);
  return memo(`${gameMode}/market-board`, [itemContext, offers], () => {
    const movers: MarketRow[] = [];
    const sellers: MarketRow[] = [];
    for (const item of itemContext.items) {
      if (!item.id || item.types?.includes("preset")) continue;
      const name = itemContext.nameById.get(item.id);
      if (!name) continue;
      const cached = projectCachedItem(item, name, offers, [], itemContext.fleaMarket);
      const best = bestSell(cached);
      if (!best) continue;
      const slots = cached.width * cached.height;
      const row: MarketRow = {
        name,
        shortName: cached.shortName,
        normalizedName: cached.normalizedName || null,
        gridImageLink: cached.gridImageLink,
        price: best.price,
        vendor: best.flea ? "Flea" : best.vendor,
        perSlot: Math.round(best.price / slots),
        changeLast48hPercent: cached.changeLast48hPercent,
      };
      // A weapon's flea price is for its default build, which is larger than the stripped size.
      if (!cached.weapon) sellers.push(row);
      const listing = cached.sellFor.find((offer) => offer.vendor.name === FLEA_MARKET)?.priceRUB;
      const average = finiteNumber(item.avg24hPrice);
      // A lone listing far from the day's average is one seller's asking price, not a market move.
      const traded = listing !== undefined && average !== null && listing >= average * 0.5 && listing <= average * 2;
      const move = Math.abs(row.changeLast48hPercent ?? 0);
      const liquid = item.types?.some((type) => MARKET_MOVER_TYPES.has(type)) ?? false;
      if (liquid && traded && listing >= MARKET_MIN_PRICE && move > 0 && move <= MARKET_MAX_MOVE_PERCENT) {
        movers.push({ ...row, price: listing, vendor: "Flea" });
      }
    }
    const change = (row: MarketRow) => row.changeLast48hPercent ?? 0;
    return {
      risers: movers.filter((row) => change(row) > 0).sort((a, b) => change(b) - change(a)).slice(0, MARKET_ROWS),
      fallers: movers.filter((row) => change(row) < 0).sort((a, b) => change(a) - change(b)).slice(0, MARKET_ROWS),
      perSlot: sellers.sort((a, b) => b.perSlot - a.perSlot).slice(0, MARKET_ROWS),
    };
  });
}

export type ItemReference = { name: string } | { slug: string };

function readItemReference(input: Record<string, unknown>): ItemReference {
  if ((input.name === undefined) === (input.slug === undefined)) {
    throw new TarkovRequestError("Provide exactly one of name or slug.");
  }
  if (input.name !== undefined) return { name: readString(input.name, "name", 500) };
  const slug = readString(input.slug, "slug", 200);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new TarkovRequestError("slug is invalid.");
  return { slug };
}

export async function getItemDetail(
  gameMode: GameMode,
  reference: ItemReference
): Promise<ComposedItem | null> {
  const [itemContext, traderNames, taskContext, relations, hideout, offers] =
    await Promise.all([
      loadItems(gameMode),
      loadTraderNames(gameMode),
      loadTasks(gameMode),
      loadRelations(gameMode),
      loadHideout(gameMode),
      loadOfferContext(gameMode, true),
    ]);
  const stations = hideout.stationNames;
  throwIfRequestAborted();

  const item =
    "slug" in reference ? itemContext.bySlug.get(reference.slug) : itemContext.byName.get(reference.name);
  if (!item?.id) return null;
  const requestedName = translate(item.name, itemContext.translations);

  const itemId = item.id;
  const details = memo(
    `${gameMode}/details`,
    [itemContext, traderNames, taskContext, relations, hideout, offers],
    () => new Map<string, ComposedItem>()
  );
  const cached = details.get(itemId);
  if (cached) return cached;
  const uses = itemUses(itemId, taskContext, traderNames, hideout);
  const tasks = uses.usedInTasks;
  const bartersUsing = relatedBarters(relations.bartersByItem, itemId)
    .map((barter) =>
      projectBarter(
        barter,
        itemContext.byId,
        itemContext.translations,
        traderNames,
        taskContext.byId,
        taskContext.translations
      )
    )
    .filter((barter) => barter.rewardItems.length > 0);
  const craftsUsing = (relations.craftsByItem.get(itemId) ?? [])
    .map((craft) =>
      projectCraft(
        craft,
        itemContext.byId,
        itemContext.translations,
        stations,
        taskContext.byId,
        taskContext.translations
      )
    )
    .filter((craft) => craft.rewardItems.length > 0);
  const bartersGiving = relatedBarters(relations.bartersByReward, itemId)
    .map((barter) =>
      projectBarter(
        barter,
        itemContext.byId,
        itemContext.translations,
        traderNames,
        taskContext.byId,
        taskContext.translations
      )
    )
    .filter((barter) => barter.requiredItems.length > 0);
  const craftsGiving = (relations.craftsByReward.get(itemId) ?? [])
    .map((craft) =>
      projectCraft(
        craft,
        itemContext.byId,
        itemContext.translations,
        stations,
        taskContext.byId,
        taskContext.translations
      )
    )
    .filter((craft) => craft.requiredItems.length > 0);

  const detail: ComposedItem = {
    ...projectCachedItem(
      item,
      requestedName,
      offers,
      tasks.map(({ name }) => ({ name })),
      itemContext.fleaMarket
    ),
    ...uses,
    bartersUsing,
    bartersFor: barterOffersOf(item, offers),
    craftsUsing,
    bartersGiving,
    craftsGiving,
    info: projectItemInfo(item, itemContext),
  };
  const key = await keyInfo(gameMode, item, itemContext);
  if (key.info) detail.key = key.info;
  // Without the maps or the wiki this time, leave it out of the cache so the next request tries again.
  if (key.complete) details.set(itemId, detail);
  return detail;
}

/** Per-map lock counts by key item id: none when the maps can't be loaded, so item pages still work. */
type KeyLocks = Map<string, CachedKeyInfo["maps"]>;

const NO_KEY_LOCKS: KeyLocks = new Map();

async function loadKeyLocks(gameMode: GameMode): Promise<KeyLocks> {
  const [mapsEnvelope, itemContext] = await Promise.all([
    loadResource<MapsData>(gameMode, "maps").catch(() => null),
    loadItems(gameMode),
  ]);
  if (!mapsEnvelope) return NO_KEY_LOCKS;
  return memo(`${gameMode}/key-locks`, [mapsEnvelope, itemContext], () => {
    const rawMaps = Object.values(mapsEnvelope.data.maps ?? {});
    const byKey: KeyLocks = new Map();
    // mapConfigs order, the maps with a keys page; counted as buildMapGuide counts them there.
    for (const config of mapConfigs) {
      const raw = rawMaps.find((map) => map.normalizedName === config.key);
      const counts = new Map<string, number>();
      for (const lock of raw?.locks ?? []) {
        if (!lock.position || !lock.key || !itemContext.nameById.get(lock.key)) continue;
        counts.set(lock.key, (counts.get(lock.key) ?? 0) + 1);
      }
      for (const [id, locks] of counts) {
        byKey.set(id, [...(byKey.get(id) ?? []), { key: config.key, name: config.name, locks }]);
      }
    }
    return byKey;
  });
}

const KEY_CATEGORIES = new Set(["Key", "Keycard", "Mechanical Key"]);

/**
 * For keys and keycards, the maps whose locks they open and, from the wiki page, what they open. Only keys
 * wait for the maps. `complete` is false when the maps or the wiki couldn't be read.
 */
async function keyInfo(
  gameMode: GameMode,
  item: RawItem,
  context: ItemsContext
): Promise<{ info?: CachedKeyInfo; complete: boolean }> {
  const isKey = (item.categories ?? []).some((id) => KEY_CATEGORIES.has(context.categoryNames.get(id) ?? ""));
  if (!item.id || !isKey) return { complete: true };
  const id = item.id;
  const [keyLocks, opens] = await Promise.all([
    loadKeyLocks(gameMode),
    findItemWikiPage(id).then(
      (page) => infoboxFact(page?.infobox.usage),
      (error: unknown) => {
        console.warn("Key wiki page could not be read:", error instanceof Error ? error.message : error);
        return undefined;
      }
    ),
  ]);
  const maps = keyLocks.get(id) ?? [];
  const complete = keyLocks !== NO_KEY_LOCKS && opens !== undefined;
  return { info: maps.length > 0 || opens ? { maps, opens: opens ?? null } : undefined, complete };
}

function projectItemInfo(item: RawItem, context: ItemsContext): CachedItemInfo {
  const description = translateNullable(item.description, context.translations);
  return {
    description: description && description !== item.description ? description.slice(0, 4_000) : null,
    weight: finiteNumber(item.weight),
    basePrice: finiteNumber(item.basePrice),
    avg24hPrice: finiteNumber(item.avg24hPrice),
    low24hPrice: finiteNumber(item.low24hPrice),
    high24hPrice: finiteNumber(item.high24hPrice),
    lastLowPrice: finiteNumber(item.lastLowPrice),
    lastOfferCount: finiteNumber(item.lastOfferCount),
    stackMaxSize: positiveFiniteNumber(item.stackMaxSize),
    // Most specific first, without the catch-all root.
    categories: (item.categories ?? [])
      .flatMap((id) => {
        const name = context.categoryNames.get(id);
        return name && name !== "Item" && name !== "Compound item" ? [name] : [];
      })
      .slice(0, 4),
  };
}

function itemUses(
  itemId: string,
  taskContext: TasksContext,
  traderNames: Map<string, string>,
  hideout: HideoutContext
): ItemUses {
  return {
    usedInTasks: (taskContext.byItem.get(itemId) ?? []).map(({ task, objectives }) =>
      projectTask(task, objectives, taskContext.translations, traderNames)
    ),
    hideoutRequirements: hideout.requirementsByItem.get(itemId) ?? [],
    hideoutSlots: hideout.slotsByItem.get(itemId) ?? [],
  };
}

/** Tasks and hideout uses for items by exact name, keyed by name; for pricing lists of loot. */
export async function getItemUses(gameMode: GameMode, names: string[]): Promise<Map<string, ItemUses>> {
  const result = new Map<string, ItemUses>();
  if (names.length === 0) return result;
  const [itemContext, traderNames, taskContext, hideout] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
    loadTasks(gameMode),
    loadHideout(gameMode),
  ]);
  throwIfRequestAborted();
  for (const name of names) {
    const id = itemContext.byName.get(name)?.id;
    if (id) result.set(name, itemUses(id, taskContext, traderNames, hideout));
  }
  return result;
}

export async function getGunList(gameMode: GameMode): Promise<GunListItem[]> {
  const context = await loadItems(gameMode);
  return memo(`${gameMode}/gun-list`, [context], () =>
    context.items
      .filter((item) => item.types?.includes("gun"))
      .map((item) => ({
        id: item.id ?? "",
        name: translate(item.name, context.translations),
        shortName:
          translate(item.shortName, context.translations) || translate(item.name, context.translations),
        gridImageLink: safeAssetUrl(item.gridImageLink),
        defaultPresetId: item.properties?.defaultPreset ?? null,
      }))
      .filter((item) => Boolean(item.id))
  );
}

async function getBuildItems(gameMode: GameMode, ids: string[]): Promise<BuildItemData[]> {
  if (ids.length === 0) return [];
  const context = await loadOfferContext(gameMode);
  throwIfRequestAborted();
  return ids.flatMap((id) => {
    const item = context.itemById.get(id);
    return item ? [projectBuildItem(item, context)] : [];
  });
}

// Include every weapon and compatible part in one lookup.
export async function getGunPartLookup(gameMode: GameMode): Promise<ReadonlyMap<string, BuildItemData>> {
  const [context, offers] = await Promise.all([loadItems(gameMode), loadOfferContext(gameMode, true)]);
  return memo(`${gameMode}/gun-part-lookup`, [context, offers], () => {
    const ids = new Set<string>();
    for (const item of context.items) {
      if (!item.id) continue;
      if (item.types?.includes("gun")) ids.add(item.id);
      for (const slot of item.properties?.slots ?? []) {
        for (const allowed of slot.filters?.allowedItems ?? []) ids.add(allowed);
      }
    }
    const lookup = new Map<string, BuildItemData>();
    for (const id of ids) {
      const item = context.byId.get(id);
      if (item) lookup.set(id, projectBuildItem(item, offers));
    }
    return lookup;
  });
}

async function getPickItems(gameMode: GameMode, ids: string[]): Promise<PickItemData[]> {
  if (ids.length === 0) return [];
  const context = await loadOfferContext(gameMode);
  throwIfRequestAborted();
  return ids.flatMap((id) => {
    const item = context.itemById.get(id);
    return item ? [projectPickItem(item, context)] : [];
  });
}

export async function getAmmoItems(
  gameMode: GameMode,
  ids: string[],
  options: { barters?: boolean } = {}
): Promise<AmmoItemData[]> {
  if (ids.length === 0) return [];
  const context = await loadOfferContext(gameMode, options.barters === true);
  throwIfRequestAborted();
  return ids.flatMap((id) => {
    const item = context.itemById.get(id);
    return item?.properties?.propertiesType === "ItemPropertiesAmmo" ? [projectAmmoItem(item, context)] : [];
  });
}

/** Every round of ammunition, for the ammo chart. */
export async function getAllAmmo(gameMode: GameMode): Promise<AmmoItemData[]> {
  const context = await loadOfferContext(gameMode);
  throwIfRequestAborted();
  return memo(`${gameMode}/all-ammo`, [context], () =>
    Array.from(context.itemById.values()).flatMap((item) =>
      item.properties?.propertiesType === "ItemPropertiesAmmo" && item.properties.caliber && item.normalizedName
        ? [projectAmmoItem(item, context)]
        : []
    )
  );
}

export async function getPreset(gameMode: GameMode, id: string): Promise<PresetContents | null> {
  const { byId } = await loadItems(gameMode);
  throwIfRequestAborted();
  const item = byId.get(id);
  if (!item) return null;
  return {
    baseItemId: item.properties?.baseItem ?? null,
    itemIds: (item.containsItems ?? []).flatMap((entry) =>
      typeof entry.item === "string"
        ? Array.from({ length: Math.min(8, Math.max(1, Math.floor(finiteNumber(entry.count) ?? 1))) }, () => entry.item as string)
        : []
    ),
  };
}

export async function getMapDetails(gameMode: GameMode, mapKey: string): Promise<MapDetails | null> {
  const [mapsEnvelope, translationsEnvelope, { nameById, byId }] =
    await Promise.all([
      loadResource<MapsData>(gameMode, "maps"),
      loadResource<TranslationDictionary>(gameMode, "maps_en"),
      loadItems(gameMode),
    ]);
  throwIfRequestAborted();
  const raw = Object.values(mapsEnvelope.data.maps ?? {}).find(
    (map) => map.normalizedName === mapKey
  );
  if (!raw) return null;
  return projectMap(
    mapKey,
    raw,
    translationsEnvelope.data,
    mapsEnvelope.data.lootContainers ?? {},
    mapsEnvelope.data.stationaryWeapons ?? {},
    nameById,
    byId,
    mapsEnvelope.data.mobs ?? {}
  );
}

async function loadItems(gameMode: GameMode): Promise<ItemsContext> {
  const [itemsEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<ItemsData>(gameMode, "items"),
    loadResource<TranslationDictionary>(gameMode, "items_en"),
  ]);
  return memo(`${gameMode}/items-context`, [itemsEnvelope, translationsEnvelope], () => {
    const items = Object.values(itemsEnvelope.data.items ?? {});
    const translations = translationsEnvelope.data;
    const byId = new Map<string, RawItem>();
    const byName = new Map<string, RawItem>();
    const bySlug = new Map<string, RawItem>();
    const nameById = new Map<string, string>();
    for (const item of items) {
      const name = translate(item.name, translations);
      byName.set(name, item);
      if (item.normalizedName) bySlug.set(item.normalizedName, item);
      if (item.id) {
        byId.set(item.id, item);
        nameById.set(item.id, name);
      }
    }
    const categoryNames = new Map<string, string>();
    for (const [id, category] of Object.entries(itemsEnvelope.data.itemCategories ?? {})) {
      const categoryName = translate(category.name, translations);
      if (categoryName) categoryNames.set(id, categoryName);
    }
    return {
      items,
      byId,
      byName,
      bySlug,
      nameById,
      translations,
      fleaMarket: itemsEnvelope.data.fleaMarket,
      categoryNames,
    };
  });
}

async function loadTasks(gameMode: GameMode): Promise<TasksContext> {
  const [tasksEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<TasksData>(gameMode, "tasks"),
    loadResource<TranslationDictionary>(gameMode, "tasks_en"),
  ]);
  return memo(`${gameMode}/tasks-context`, [tasksEnvelope, translationsEnvelope], () => {
    const tasks = Object.values(tasksEnvelope.data.tasks ?? {});
    return {
      tasks,
      byId: new Map(tasks.flatMap((task) => (task.id ? ([[task.id, task]] as const) : []))),
      byItem: indexTasksByItem(tasks),
      questItems: tasksEnvelope.data.questItems ?? {},
      prestigeLevels: new Map(
        (tasksEnvelope.data.prestige ?? []).flatMap((entry) => {
          const level = finiteNumber(entry.prestigeLevel);
          return entry.id && level !== null ? [[entry.id, level] as const] : [];
        })
      ),
      translations: translationsEnvelope.data,
    };
  });
}

async function loadNames(gameMode: GameMode, resource: "traders" | "hideout") {
  const [entitiesEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<Dictionary<RawNamedEntity>>(gameMode, resource),
    loadResource<TranslationDictionary>(gameMode, `${resource}_en`),
  ]);
  return memo(`${gameMode}/${resource}-names`, [entitiesEnvelope, translationsEnvelope], () =>
    new Map(
      Object.entries(entitiesEnvelope.data).map(([id, entity]) => [
        id,
        translate(entity.name, translationsEnvelope.data) || entity.normalizedName || id,
      ])
    )
  );
}

function loadTraderNames(gameMode: GameMode) {
  return loadNames(gameMode, "traders");
}

async function loadOfferContext(gameMode: GameMode, withBarters = false): Promise<OfferContext> {
  const [items, traderNames, tasks, relations] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
    loadTasks(gameMode),
    withBarters ? loadRelations(gameMode) : null,
  ]);
  return memo(`${gameMode}/offer-context/${withBarters}`, [items, traderNames, tasks, relations], () => {
    const unlocks = new Map<string, TaskUnlock>();
    return {
      traderNames,
      itemById: items.byId,
      translations: items.translations,
      taskUnlock: (id) => {
        if (!id) return null;
        let unlock = unlocks.get(id);
        if (!unlock) {
          unlock = projectOfferUnlock(id, tasks, traderNames);
          unlocks.set(id, unlock);
        }
        return unlock;
      },
      ...(relations ? { bartersByReward: relations.bartersByReward } : {}),
    };
  });
}

// Unknown tasks keep their id as their name.
function projectOfferUnlock(id: string, tasks: TasksContext, traderNames: Map<string, string>): TaskUnlock {
  const task = tasks.byId.get(id);
  return {
    id,
    name: (task && translate(task.name, tasks.translations)) || id,
    trader: (task?.trader && (traderNames.get(task.trader) ?? task.trader)) || null,
    minPlayerLevel: finiteNumber(task?.minPlayerLevel),
  };
}

export async function getTaskIndex(gameMode: GameMode): Promise<TaskIndex> {
  const [tasks, traderNames] = await Promise.all([loadTasks(gameMode), loadTraderNames(gameMode)]);
  return memo(`${gameMode}/task-index`, [tasks, traderNames], () => {
    const index = new Map<string, TaskNode>();
    for (const task of tasks.tasks) {
      if (!task.id) continue;
      const name = translate(task.name, tasks.translations) || task.id;
      index.set(task.id, {
        id: task.id,
        name,
        normalizedName: task.normalizedName ?? null,
        trader: (task.trader && (traderNames.get(task.trader) ?? task.trader)) || null,
        minPlayerLevel: finiteNumber(task.minPlayerLevel) ?? 0,
        faction: task.factionName && task.factionName !== "Any" ? task.factionName : null,
        requires: (task.taskRequirements ?? []).flatMap((requirement) =>
          requirement.task ? [{ id: requirement.task, status: requirement.status ?? [] }] : []
        ),
        traderLevels: (task.traderRequirements ?? []).flatMap((requirement) => {
          const level = finiteNumber(requirement.value);
          return requirement.trader && requirement.requirementType === "level" && level !== null
            ? [{ trader: traderNames.get(requirement.trader) ?? requirement.trader, level }]
            : [];
        }),
      });
    }
    return index;
  });
}

export interface WeaponBuildRequirement {
  name: string;
  compareMethod: ">=" | "<=" | "=";
  value: number;
}

export interface WeaponBuildObjective {
  weaponId: string;
  /** Parts the build must contain, by id. */
  containsAll: string[];
  /** Item categories the build must contain a part of, by tarkov.dev category id. */
  containsCategory: string[];
  /** Only the requirements that constrain: tarkov.dev lists unused ones as ">= 0". */
  requirements: WeaponBuildRequirement[];
}

export interface WeaponBuildTask {
  id: string;
  name: string;
  normalizedName: string;
  trader: string | null;
  minPlayerLevel: number;
  faction: string | null;
  wikiLink: string | null;
  objectives: WeaponBuildObjective[];
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const id = typeof entry === "string" ? entry : isRecord(entry) && typeof entry.id === "string" ? entry.id : null;
        return id ? [id] : [];
      })
    : [];
}

function buildRequirements(value: unknown): WeaponBuildRequirement[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([name, rule]): WeaponBuildRequirement[] => {
    if (!isRecord(rule)) return [];
    const compareMethod = rule.compareMethod;
    const amount = finiteNumber(rule.value as number | null | undefined);
    if (amount === null || (compareMethod !== ">=" && compareMethod !== "<=" && compareMethod !== "=")) return [];
    if (compareMethod === ">=" && amount <= 0) return [];
    return [{ name, compareMethod, value: amount }];
  });
}

/** Tasks that ask for a weapon built to a spec: the Gunsmith chain and a few others. */
export async function getWeaponBuildTasks(gameMode: GameMode): Promise<WeaponBuildTask[]> {
  const [tasks, traderNames] = await Promise.all([loadTasks(gameMode), loadTraderNames(gameMode)]);
  return memo(`${gameMode}/weapon-build-tasks`, [tasks, traderNames], () =>
    tasks.tasks.flatMap((task): WeaponBuildTask[] => {
      if (!task.id || !task.normalizedName) return [];
      const objectives = (task.objectives ?? []).flatMap((objective): WeaponBuildObjective[] =>
        objective.type === "buildWeapon" && objective.item && !objective.optional
          ? [
              {
                weaponId: objective.item,
                containsAll: stringIds(objective.containsAll),
                containsCategory: stringIds(objective.containsCategory),
                requirements: buildRequirements(objective.buildAttributes),
              },
            ]
          : []
      );
      if (objectives.length === 0) return [];
      return [
        {
          id: task.id,
          name: translate(task.name, tasks.translations) || task.normalizedName,
          normalizedName: task.normalizedName,
          trader: (task.trader && (traderNames.get(task.trader) ?? task.trader)) || null,
          minPlayerLevel: finiteNumber(task.minPlayerLevel) ?? 0,
          faction: task.factionName && task.factionName !== "Any" ? task.factionName : null,
          wikiLink: safeHttpsUrl(task.wikiLink),
          objectives,
        },
      ];
    })
  );
}

/** Alternatives beyond this many ("sell any items") are described rather than listed. */
const MAX_LISTED_ALTERNATIVES = 100;
const REQUIREMENT_STATUSES = new Set<string>(["complete", "active", "failed"]);

function requirementStatuses(status: string[] | null | undefined): RequirementStatus[] {
  return (status ?? []).filter((entry): entry is RequirementStatus => REQUIREMENT_STATUSES.has(entry));
}

function questFaction(task: RawTask): Faction | null {
  return isFaction(task.factionName) ? task.factionName : null;
}

/** Items an objective takes or uses up; null for objectives that need no item from the player. */
function objectiveNeedItems(objective: RawTaskObjective): string[] | null {
  switch (objective.type) {
    case "giveItem":
    case "plantItem":
    case "sellItem":
    case "findItem":
      return objective.items ?? [];
    case "mark":
      return objective.markerItem ? [objective.markerItem] : [];
    case "useItem":
      return objective.useAny ?? [];
    default:
      return null;
  }
}

/**
 * Each objective that takes items is one need. A find objective for the same items joins it, so
 * finding and handing over counts once; a find objective nothing hands over is a need of its own.
 */
function questNeeds(task: RawTask, translations: TranslationDictionary, itemById: Map<string, RawItem>): QuestItemNeed[] {
  const needs: (QuestItemNeed & { key: string })[] = [];
  const finds: { id: string; items: string[]; key: string; count: number; foundInRaid: boolean; label: string }[] = [];
  for (const objective of task.objectives ?? []) {
    const items = objectiveNeedItems(objective);
    const count = finiteNumber(objective.count) ?? 1;
    if (!items || objective.optional || !objective.id || count <= 0) continue;
    const known = Array.from(new Set(items.filter((id) => itemById.has(id))));
    if (known.length === 0) continue;
    const entry = {
      id: objective.id,
      items: known,
      key: known.toSorted().join(","),
      count,
      foundInRaid: objective.foundInRaid === true,
      label: translate(objective.description, translations),
    };
    if (objective.type === "findItem") finds.push(entry);
    else needs.push(questNeed(entry));
  }
  for (const find of finds) {
    const handOver = needs.find((need) => need.key === find.key);
    if (handOver) {
      handOver.objectives.push(find.id);
      handOver.foundInRaid ||= find.foundInRaid;
    } else {
      needs.push(questNeed(find));
    }
  }
  return needs.map(({ key: _key, ...need }) => need);
}

function questNeed(entry: { id: string; items: string[]; key: string; count: number; foundInRaid: boolean; label: string }) {
  const several = entry.items.length > 1;
  return {
    key: entry.key,
    objectives: [entry.id],
    items: entry.items.length > MAX_LISTED_ALTERNATIVES ? [] : entry.items,
    count: entry.count,
    foundInRaid: entry.foundInRaid,
    ...(several ? { label: entry.label, alternatives: entry.items.length } : {}),
  };
}

/**
 * Quest slugs are tarkov.dev's normalizedName. When tasks share one (faction variants), a task
 * for every faction keeps it and USEC or BEAR tasks get "-usec" or "-bear"; anything still
 * shared gets the task id. Tasks without a valid slug get none.
 */
function questSlugs(tasks: RawTask[]): Map<string, string> {
  const groups = new Map<string, RawTask[]>();
  for (const task of tasks) {
    if (!task.id || !task.normalizedName || !isItemSlug(task.normalizedName)) continue;
    groups.set(task.normalizedName, [...(groups.get(task.normalizedName) ?? []), task]);
  }
  const slugs = new Map<string, string>();
  const used = new Set<string>();
  for (const [slug, group] of groups) {
    if (group.length === 1) {
      slugs.set(group[0].id!, slug);
      used.add(slug);
    }
  }
  for (const [slug, group] of groups) {
    if (group.length === 1) continue;
    const candidates = group.toSorted((a, b) => a.id!.localeCompare(b.id!)).map((task) => {
      const faction = questFaction(task);
      return { task, slug: faction ? `${slug}-${faction.toLowerCase()}` : slug };
    });
    for (const candidate of candidates) {
      const shared = used.has(candidate.slug) || candidates.filter((other) => other.slug === candidate.slug).length > 1;
      const final = shared ? `${slug}-${candidate.task.id!.toLowerCase()}` : candidate.slug;
      if (!isItemSlug(final) || used.has(final)) continue;
      slugs.set(candidate.task.id!, final);
      used.add(final);
    }
  }
  return slugs;
}

async function loadMapNames(gameMode: GameMode): Promise<Map<string, QuestMap>> {
  const [mapsEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<MapsData>(gameMode, "maps"),
    loadResource<TranslationDictionary>(gameMode, "maps_en"),
  ]);
  return memo(`${gameMode}/map-names`, [mapsEnvelope, translationsEnvelope], () =>
    new Map(
      Object.entries(mapsEnvelope.data.maps ?? {}).flatMap(([id, map]): [string, QuestMap][] => {
        const key = map.normalizedName;
        if (!key || !isItemSlug(key)) return [];
        return [[id, { key, name: translate(map.name, translationsEnvelope.data) || key, page: mapPageKey(key) }]];
      })
    )
  );
}

function questItem(item: RawItem, translations: TranslationDictionary): QuestItem {
  return {
    name: translate(item.name, translations),
    shortName: translateNullable(item.shortName, translations),
    slug: item.normalizedName && isItemSlug(item.normalizedName) ? item.normalizedName : null,
    image: safeAssetUrl(item.gridImageLink),
  };
}

function projectQuestSummary(
  task: RawTask & { id: string },
  slug: string | null,
  tasks: TasksContext,
  traderNames: Map<string, string>,
  items: ItemsContext,
  mapNames: Map<string, QuestMap>
): QuestSummary {
  const objectives = (task.objectives ?? []).filter((objective) => objective.id);
  const mapKeys = [task.map, ...objectives.flatMap((objective) => objective.maps ?? [])].flatMap((id) => {
    const map = id ? mapNames.get(id) : undefined;
    return map ? [map.key] : [];
  });
  return {
    id: task.id,
    name: translate(task.name, tasks.translations) || task.id,
    slug,
    trader: (task.trader && (traderNames.get(task.trader) ?? task.trader)) || null,
    minPlayerLevel: finiteNumber(task.minPlayerLevel) ?? 0,
    faction: questFaction(task),
    kappaRequired: task.kappaRequired === true,
    lightkeeperRequired: task.lightkeeperRequired === true,
    maps: Array.from(new Set(mapKeys)),
    requires: taskRequirements(task.taskRequirements),
    traderLevels: (task.traderRequirements ?? []).flatMap((requirement) => {
      const level = finiteNumber(requirement.value);
      return requirement.trader && requirement.requirementType === "level" && level !== null
        ? [{ trader: traderNames.get(requirement.trader) ?? requirement.trader, level }]
        : [];
    }),
    failedBy: taskRequirements(
      (task.failConditions ?? []).flatMap((condition) =>
        condition.type === "taskStatus" ? [{ task: condition.task, status: condition.status }] : []
      )
    ),
    prestige: task.requiredPrestige ? (tasks.prestigeLevels.get(task.requiredPrestige) ?? null) : null,
    experience: finiteNumber(task.experience) ?? 0,
    needs: questNeeds(task, tasks.translations, items.byId),
    keys: (task.neededKeys ?? []).flatMap((entry): QuestKeys[] => {
      const keys = Array.from(new Set((entry.keys ?? []).filter((id) => items.byId.has(id))));
      return keys.length ? [{ map: (entry.map && mapNames.get(entry.map)?.key) || null, keys }] : [];
    }),
    objectives: objectives.flatMap((objective) => (objective.optional ? [] : [objective.id!])),
    optionalObjectives: objectives.flatMap((objective) => (objective.optional ? [objective.id!] : [])),
    image: safeAssetUrl(task.taskImageLink),
  };
}

function taskRequirements(requirements: RawTask["taskRequirements"]): QuestRequirement[] {
  return (requirements ?? []).flatMap((requirement) => {
    const status = requirementStatuses(requirement.status);
    return requirement.task && status.length ? [{ id: requirement.task, status }] : [];
  });
}

/** Every task in the game mode, with the items, maps and traders it mentions. */
export async function getQuestList(gameMode: GameMode): Promise<QuestList> {
  const [tasks, traderNames, items, mapNames] = await Promise.all([
    loadTasks(gameMode),
    loadTraderNames(gameMode),
    loadItems(gameMode),
    loadMapNames(gameMode),
  ]);
  return memo(`${gameMode}/quest-list`, [tasks, traderNames, items, mapNames], () => {
    const slugs = questSlugs(tasks.tasks);
    const summaries = tasks.tasks.flatMap((task) =>
      task.id ? [projectQuestSummary(task as RawTask & { id: string }, slugs.get(task.id) ?? null, tasks, traderNames, items, mapNames)] : []
    );
    const givers = new Set(summaries.map((quest) => quest.trader));
    const traders = orderTraders(Array.from(new Set(traderNames.values())).filter((name) => givers.has(name)));
    const quests = orderQuests(summaries, traders);
    const itemIds = new Set(
      quests.flatMap((quest) => [...quest.needs.flatMap((need) => need.items), ...quest.keys.flatMap((entry) => entry.keys)])
    );
    const mapKeys = new Set(quests.flatMap((quest) => [...quest.maps, ...quest.keys.flatMap((entry) => (entry.map ? [entry.map] : []))]));
    return {
      quests,
      items: Object.fromEntries(Array.from(itemIds, (id) => [id, questItem(items.byId.get(id)!, items.translations)])),
      maps: Object.fromEntries(Array.from(mapNames.values()).filter((map) => mapKeys.has(map.key)).map((map) => [map.key, map])),
      traders,
    };
  });
}

/** Slugs of every quest with a page in the game mode. */
export async function listQuestSlugs(gameMode: GameMode): Promise<string[]> {
  const list = await getQuestList(gameMode);
  return list.quests.flatMap((quest) => (quest.slug ? [quest.slug] : []));
}

/** Items an objective names, beyond those it takes: the weapon to build. */
function objectiveItems(objective: RawTaskObjective): string[] {
  if (objective.type === "buildWeapon") return objective.item ? [objective.item] : [];
  return objectiveNeedItems(objective) ?? [];
}

const GEAR_CONDITIONS = ["usingWeapon", "usingWeaponMods", "wearing", "notWearing"] as const;
// Mods and worn gear come in groups to use together; weapons and gear not to wear are single items.
const GROUPED_CONDITIONS = new Set<string>(["usingWeaponMods", "wearing"]);

// Condition items are ids or {id, name} records.
const conditionItemId = (entry: unknown) => (typeof entry === "string" ? entry : isRecord(entry) && typeof entry.id === "string" ? entry.id : null);

/** The weapons, mods and gear an objective asks to use, wear or not wear, as known item ids. */
function objectiveConditions(
  objective: RawTaskObjective,
  known: (id: string | null | undefined) => id is string
): QuestObjectiveCondition[] {
  return GEAR_CONDITIONS.flatMap((kind): QuestObjectiveCondition[] => {
    const value = objective[kind];
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const groups = (GROUPED_CONDITIONS.has(kind) ? value : value.map((entry) => [entry])).flatMap((group) => {
      const found = Array.from(new Set((Array.isArray(group) ? group : [group]).map(conditionItemId))).filter(known);
      const key = found.toSorted().join(",");
      if (found.length === 0 || seen.has(key)) return [];
      seen.add(key);
      return [found];
    });
    return groups.length > 0 ? [{ kind, groups: groups.slice(0, MAX_LISTED_ALTERNATIVES) }] : [];
  });
}

const readableSkill = (skill: string) => skill.replace(/([a-z])([A-Z])/g, "$1 $2");

function projectRewards(
  rewards: RawTaskRewards | null | undefined,
  traderNames: Map<string, string>,
  stationNames: Map<string, string>,
  known: (id: string | null | undefined) => id is string
): QuestRewards {
  const trader = (id: string) => traderNames.get(id) ?? id;
  return {
    items: (rewards?.items ?? []).flatMap((entry) => {
      const count = finiteNumber(entry.count) ?? 1;
      return known(entry.item) && count > 0 ? [{ id: entry.item, count }] : [];
    }),
    traderStanding: (rewards?.traderStanding ?? []).flatMap((entry) => {
      const standing = finiteNumber(entry.standing);
      return entry.trader && standing !== null ? [{ trader: trader(entry.trader), standing }] : [];
    }),
    offerUnlocks: (rewards?.offerUnlock ?? []).flatMap((entry) =>
      known(entry.item) && entry.trader ? [{ id: entry.item, trader: trader(entry.trader), level: finiteNumber(entry.level) }] : []
    ),
    skills: (rewards?.skillLevelReward ?? []).flatMap((entry) => {
      const level = finiteNumber(entry.level);
      return entry.skill && level !== null ? [{ name: readableSkill(entry.skill), level }] : [];
    }),
    traderUnlocks: (rewards?.traderUnlock ?? []).map(trader),
    craftUnlocks: (rewards?.craftUnlock ?? []).flatMap((entry) =>
      known(entry.item) && entry.station
        ? [
            {
              id: entry.item,
              count: finiteNumber(entry.count) ?? 1,
              station: stationNames.get(entry.station) ?? entry.station,
              level: finiteNumber(entry.level),
            },
          ]
        : []
    ),
  };
}

function pricedQuestItem(item: RawItem, items: ItemsContext, offers: OfferContext): PricedQuestItem {
  const base = questItem(item, items.translations);
  const cached = projectCachedItem(item, base.name, offers, [], items.fleaMarket);
  const buy = cached.buyFor.reduce<CachedVendorPrice | null>(
    (cheapest, offer) => (!cheapest || offer.priceRUB < cheapest.priceRUB ? offer : cheapest),
    null
  );
  const sell = bestSell(cached);
  return {
    ...base,
    buy: buy ? { price: buy.priceRUB, vendor: buy.vendor.name } : null,
    sell: sell ? { price: sell.price, vendor: sell.vendor } : null,
  };
}

/** One quest by slug, with its objectives, rewards, chain and priced items; null for an unknown slug. */
export async function getQuestDetail(gameMode: GameMode, slug: string): Promise<QuestDetail | null> {
  const [list, tasks, traderNames, items, mapNames, offers, stationNames] = await Promise.all([
    getQuestList(gameMode),
    loadTasks(gameMode),
    loadTraderNames(gameMode),
    loadItems(gameMode),
    loadMapNames(gameMode),
    loadOfferContext(gameMode),
    loadStationNames(gameMode),
  ]);
  throwIfRequestAborted();
  const graph = questGraph(list.quests);
  const quest = graph.bySlug.get(slug);
  const task = quest && tasks.byId.get(quest.id);
  if (!quest || !task) return null;
  const details = memo(
    `${gameMode}/quest-details`,
    [list, tasks, traderNames, items, mapNames, offers, stationNames],
    () => new Map<string, QuestDetail>()
  );
  const cached = details.get(quest.id);
  if (cached) return cached;

  const known = (id: string | null | undefined): id is string => Boolean(id && items.byId.has(id));
  const objectives = (task.objectives ?? []).flatMap((objective): QuestObjective[] => {
    if (!objective.id) return [];
    const named = Array.from(new Set(objectiveItems(objective).filter(known)));
    const questItemId = objective.questItem;
    const special = questItemId && Object.hasOwn(tasks.questItems, questItemId) ? tasks.questItems[questItemId] : null;
    return [
      {
        id: objective.id,
        type: objective.type ?? null,
        description: translate(objective.description, tasks.translations),
        count: finiteNumber(objective.count),
        foundInRaid: objective.foundInRaid === true,
        optional: objective.optional === true,
        maps: Array.from(new Set((objective.maps ?? []).flatMap((id) => mapNames.get(id)?.key ?? []))),
        items: named.length > MAX_LISTED_ALTERNATIVES ? [] : named,
        alternatives: named.length,
        questItem: special
          ? { name: translate(special.name, tasks.translations) || questItemId!, image: safeAssetUrl(special.gridImageLink) }
          : null,
        requiredKeys: (objective.requiredKeys ?? [])
          .map((group) => Array.from(new Set(group.filter(known))))
          .filter((group) => group.length > 0),
        conditions: objectiveConditions(objective, known),
      },
    ];
  });
  const rewards = projectRewards(task.finishRewards, traderNames, stationNames, known);
  const startRewards = projectRewards(task.startRewards, traderNames, stationNames, known);
  const unlocks = [...(graph.unlocks.get(quest.id) ?? [])];
  const chain = { before: chainBefore(graph, quest.id), after: chainAfter(graph, quest.id) };

  const questIds = new Set([
    quest.id,
    ...quest.requires.map((entry) => entry.id),
    ...quest.failedBy.map((entry) => entry.id),
    ...unlocks.map((entry) => entry.id),
    ...chain.before,
    ...chain.after,
  ]);
  const quests: Record<string, QuestRef> = {};
  for (const id of questIds) {
    const entry = graph.byId.get(id);
    if (entry) {
      const { name, slug: entrySlug, trader, minPlayerLevel, faction } = entry;
      quests[id] = { id, name, slug: entrySlug, trader, minPlayerLevel, faction };
    }
  }
  const itemIds = new Set([
    ...quest.needs.flatMap((need) => need.items),
    ...quest.keys.flatMap((entry) => entry.keys),
    ...objectives.flatMap((objective) => [
      ...objective.items,
      ...objective.requiredKeys.flat(),
      ...objective.conditions.flatMap((condition) => condition.groups.flat()),
    ]),
    ...[rewards, startRewards].flatMap((entry) => [
      ...entry.items.map((reward) => reward.id),
      ...entry.offerUnlocks.map((offer) => offer.id),
      ...entry.craftUnlocks.map((craft) => craft.id),
    ]),
  ]);
  const mapKeys = new Set([
    ...quest.maps,
    ...objectives.flatMap((objective) => objective.maps),
    ...quest.keys.flatMap((entry) => (entry.map ? [entry.map] : [])),
  ]);
  const detail: QuestDetail = {
    gameMode,
    quest,
    wikiLink: safeHttpsUrl(task.wikiLink),
    restartable: task.restartable === true,
    objectives,
    rewards,
    startRewards,
    prerequisites: quest.requires,
    unlocks,
    chain,
    quests,
    items: Object.fromEntries(Array.from(itemIds, (id) => [id, pricedQuestItem(items.byId.get(id)!, items, offers)])),
    maps: Object.fromEntries(Array.from(mapNames.values()).filter((map) => mapKeys.has(map.key)).map((map) => [map.key, map])),
  };
  details.set(quest.id, detail);
  return detail;
}

/** tarkov.dev item categories by id, with their English names and slugs. */
export async function getItemCategories(gameMode: GameMode): Promise<ReadonlyMap<string, { name: string; normalizedName: string }>> {
  const [itemsEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<ItemsData>(gameMode, "items"),
    loadResource<TranslationDictionary>(gameMode, "items_en"),
  ]);
  return memo(`${gameMode}/item-categories`, [itemsEnvelope, translationsEnvelope], () =>
    new Map(
      Object.entries(itemsEnvelope.data.itemCategories ?? {}).map(([id, category]) => [
        id,
        {
          name: translate(category.name, translationsEnvelope.data) || category.normalizedName || id,
          normalizedName: category.normalizedName ?? id,
        },
      ])
    )
  );
}

function loadStationNames(gameMode: GameMode) {
  return loadNames(gameMode, "hideout");
}

/** Hideout upgrades that consume each item, and station slots each item is installed in. */
async function loadHideout(gameMode: GameMode): Promise<HideoutContext> {
  const [stationsEnvelope, translationsEnvelope, stationNames] = await Promise.all([
    loadResource<Dictionary<RawHideoutStation>>(gameMode, "hideout"),
    loadResource<TranslationDictionary>(gameMode, "hideout_en"),
    loadStationNames(gameMode),
  ]);
  return memo(`${gameMode}/hideout-context`, [stationsEnvelope, translationsEnvelope, stationNames], () => {
    const requirementsByItem = new Map<string, CachedHideoutRequirement[]>();
    const slotsByItem = new Map<string, CachedHideoutSlot[]>();
    const push = <T>(index: Map<string, T[]>, id: string, entry: T) => {
      const entries = index.get(id) ?? [];
      entries.push(entry);
      index.set(id, entries);
    };
    for (const [id, station] of Object.entries(stationsEnvelope.data)) {
      const name = stationNames.get(id) ?? id;
      for (const level of station.levels ?? []) {
        const levelNumber = finiteNumber(level.level) ?? 0;
        for (const requirement of level.itemRequirements ?? []) {
          const count = finiteNumber(requirement.count);
          if (!requirement.item || count === null || count <= 0) continue;
          push(requirementsByItem, requirement.item, {
            station: { name },
            level: levelNumber,
            count,
            foundInRaid: requirement.attributes?.foundInRaid === true,
          });
        }
        for (const bonus of level.bonuses ?? []) {
          const slots = finiteNumber(bonus.value);
          if (bonus.type !== "AdditionalSlots" || slots === null || slots <= 0) continue;
          for (const itemId of new Set(bonus.slotItems ?? [])) {
            push(slotsByItem, itemId, { station: { name }, level: levelNumber, slots });
          }
        }
      }
    }
    return { stationNames, requirementsByItem, slotsByItem };
  });
}

async function loadResource<T>(
  gameMode: GameMode,
  resource: Resource
): Promise<UpstreamEnvelope<T>> {
  const cacheKey = `${gameMode}/${resource}`;
  let entry = resourceCache.get(cacheKey);
  if (!entry) {
    entry = { fetchedAt: 0 };
    resourceCache.set(cacheKey, entry);
  }
  const context = operationContext.getStore();
  context?.resources.add(entry);
  if (!entry.value) await seedFromSnapshot(gameMode, resource, entry);

  const policy = RESOURCE_POLICIES[resource];
  const age = Date.now() - entry.fetchedAt;
  if (entry.value && age < policy.freshMs) return recordUse(cacheKey, entry) as UpstreamEnvelope<T>;
  if (entry.value && age < policy.revalidateMs) {
    void refreshResource(gameMode, resource, entry).catch(() => undefined);
    return recordUse(cacheKey, entry) as UpstreamEnvelope<T>;
  }
  // Due for a refresh. With a copy this read accepts, wait for the refresh as long as the read allows
  // (not at all while tarkov.dev is failing) and take the copy if it fails or doesn't arrive; without
  // one, wait for it, retrying quick failures.
  const fallback =
    entry.value && age < (context?.maxStaleMs ?? RESOURCE_MAX_STALE_MS)
      ? { value: entry.value, fetchedAt: entry.fetchedAt, source: entry.source ?? "tarkov.dev" }
      : undefined;
  const failing = (entry.failures ?? 0) > 0;
  const refresh = refreshResource(gameMode, resource, entry, fallback ? 1 : UPSTREAM_ATTEMPTS);
  if (!fallback) {
    await refresh;
    return recordUse(cacheKey, entry) as UpstreamEnvelope<T>;
  }
  refresh.catch(() => undefined);
  const staleWaitMs = context?.staleWaitMs ?? Number.POSITIVE_INFINITY;
  const waitMs = failing || (entry.slowRefresh && Number.isFinite(staleWaitMs)) ? 0 : staleWaitMs;
  const fresh = waitMs > 0 && (await settledWithin(refresh, waitMs));
  if (fresh) return recordUse(cacheKey, entry) as UpstreamEnvelope<T>;
  if (waitMs > 0 && entry.inFlight === refresh) entry.slowRefresh = true;
  return recordUse(cacheKey, entry, { ...fallback, stale: true }) as UpstreamEnvelope<T>;
}

/** The promise's value if it fulfils within ms (or at all, for Infinity); undefined if it rejects or takes longer. */
function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  if (!Number.isFinite(ms)) return promise.catch(() => undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

/** Starts an empty entry from the deployment's snapshot, once. Leaves it empty without one. */
function seedFromSnapshot(gameMode: GameMode, resource: Resource, entry: ResourceCacheEntry) {
  entry.seed ??= readSnapshot(gameMode, resource)
    .then((copy) => {
      if (!copy || entry.value) return;
      const value = copy.value;
      if (!isRecord(value) || !("data" in value) || !validateResourceData(resource, value.data)) return;
      entry.value = value as unknown as UpstreamEnvelope<unknown>;
      entry.fetchedAt = copy.fetchedAt;
      entry.etag = copy.etag;
      entry.lastModified = copy.lastModified;
      entry.source = "deployment";
    })
    .catch(() => undefined);
  return entry.seed;
}

/** Hands out the entry's current copy, or the given one, and notes it (with its age and source) for the read. */
function recordUse(
  key: string,
  entry: ResourceCacheEntry,
  copy: { value: UpstreamEnvelope<unknown>; fetchedAt: number; source: DataSource; stale: boolean } = {
    value: entry.value!,
    fetchedAt: entry.fetchedAt,
    source: entry.source ?? "tarkov.dev",
    stale: false,
  }
) {
  const used = operationContext.getStore()?.used;
  const seen = used?.get(key);
  const older = seen && seen.fetchedAt <= copy.fetchedAt ? seen : copy;
  used?.set(key, {
    entry,
    value: !seen || seen.value === copy.value ? copy.value : MIXED_COPIES,
    fetchedAt: older.fetchedAt,
    source: older.source,
    stale: copy.stale || (seen?.stale ?? false),
  });
  return copy.value;
}

/**
 * Refreshes the dataset, sharing one refresh among concurrent callers. Rejects when it fails, or at
 * once, without a request, while waiting out an earlier failure; callers with a copy fall back to it.
 */
function refreshResource(gameMode: GameMode, resource: Resource, entry: ResourceCacheEntry, attempts = 1) {
  if (entry.inFlight) return entry.inFlight;
  const waitMs = entry.retryAt === undefined ? 0 : entry.retryAt - Date.now();
  if (waitMs > 0) {
    return Promise.reject(
      new TarkovUpstreamError(`Tarkov.dev is unavailable; ${resource} will be retried shortly.`, undefined, waitMs)
    );
  }
  const inFlight = loadCurrent(gameMode, resource, entry, attempts)
    .then((result) => {
      entry.value = result.value;
      entry.source = "tarkov.dev";
      entry.etag = result.etag;
      entry.lastModified = result.lastModified;
      entry.fetchedAt = result.checkedAt;
      entry.failedAt = undefined;
      entry.failures = 0;
      entry.retryAt = undefined;
      entry.lastError = undefined;
      return result.value;
    })
    .catch((error: unknown) => {
      const now = Date.now();
      entry.failedAt = now;
      entry.failures = (entry.failures ?? 0) + 1;
      entry.retryAt = now + retryDelay(entry.failures, error);
      entry.lastError = error instanceof Error ? error.message : String(error);
      if (entry.value) console.warn(`Tarkov ${resource} refresh failed; serving the copy from ${new Date(entry.fetchedAt).toISOString()}.`);
      throw new TarkovUpstreamError(
        entry.lastError,
        error instanceof TarkovUpstreamError ? error.status : undefined,
        entry.retryAt - now,
        error instanceof TarkovUpstreamError && error.permanent
      );
    })
    .finally(() => {
      entry.inFlight = undefined;
      entry.slowRefresh = undefined;
    });
  entry.inFlight = inFlight;
  return inFlight;
}

function retryDelay(failures: number, error: unknown) {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 10));
  const jittered = backoff * (0.8 + Math.random() * 0.4);
  const requested = error instanceof TarkovUpstreamError ? (error.retryAfterMs ?? 0) : 0;
  return Math.max(jittered, Math.min(requested, RETRY_AFTER_MAX_MS));
}

/** How long to wait before asking again within one refresh, or undefined to give up. */
function attemptDelay(error: unknown, attempt: number): number | undefined {
  if (!(error instanceof TarkovUpstreamError) || error.permanent) return undefined;
  if (error.timedOut) return undefined;
  const status = error.status;
  if (status === 429) {
    const requested = error.retryAfterMs ?? UPSTREAM_RETRY_DELAYS_MS[attempt - 1];
    return requested <= UPSTREAM_RETRY_AFTER_WAIT_MS ? requested : undefined;
  }
  if (status !== undefined && status < 500) return undefined;
  const base = UPSTREAM_RETRY_DELAYS_MS[attempt - 1];
  return Math.round(base * (0.5 + Math.random()));
}

async function fetchWithRetries(
  gameMode: GameMode,
  resource: Resource,
  attempts: number,
  validators?: { etag?: string; lastModified?: string }
): Promise<Fetched> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withUpstreamSlot(() => fetchResource(gameMode, resource, validators));
    } catch (error) {
      const delay = attempt < attempts ? attemptDelay(error, attempt) : undefined;
      if (delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export interface DatasetStatus {
  gameMode: GameMode;
  dataset: Resource;
  /** Whether this instance holds a copy. Datasets load when a tool first needs them. */
  loaded: boolean;
  source: DataSource | null;
  /** When the copy was last confirmed with tarkov.dev (or fetched by the build), as an ISO time. */
  asOf: string | null;
  ageSeconds: number | null;
  /** The freshness target: a copy older than this is refreshed on its next use. */
  refreshAfterSeconds: number;
  state: "fresh" | "refreshing" | "due" | "failing" | "not loaded";
  lastError: string | null;
  /** While failing: seconds until tarkov.dev is asked again. */
  retryAfterSeconds: number | null;
}

/** What this instance holds of each dataset. Reads no data and makes no requests. */
export function tarkovDataStatus(gameModes: readonly GameMode[] = ["regular", "pve"]): DatasetStatus[] {
  const now = Date.now();
  return gameModes.flatMap((gameMode) =>
    (Object.keys(RESOURCE_POLICIES) as Resource[]).map((dataset): DatasetStatus => {
      const entry = resourceCache.get(`${gameMode}/${dataset}`);
      const policy = RESOURCE_POLICIES[dataset];
      const loaded = entry?.value !== undefined;
      const age = loaded ? Math.max(0, now - entry!.fetchedAt) : null;
      const retryIn = entry?.retryAt !== undefined && entry.retryAt > now ? entry.retryAt - now : null;
      const state: DatasetStatus["state"] = !loaded
        ? entry?.failedAt !== undefined ? "failing" : "not loaded"
        : entry!.failedAt !== undefined
          ? "failing"
          : entry!.inFlight
            ? "refreshing"
            : age! < policy.freshMs
              ? "fresh"
              : "due";
      return {
        gameMode,
        dataset,
        loaded,
        source: loaded ? (entry!.source ?? "tarkov.dev") : null,
        asOf: loaded ? new Date(entry!.fetchedAt).toISOString() : null,
        ageSeconds: age === null ? null : Math.round(age / 1000),
        refreshAfterSeconds: policy.freshMs / 1000,
        state,
        lastError: entry?.lastError ?? null,
        retryAfterSeconds: retryIn === null ? null : Math.ceil(retryIn / 1000),
      };
    })
  );
}

async function loadCurrent(
  gameMode: GameMode,
  resource: Resource,
  entry: ResourceCacheEntry,
  attempts: number
): Promise<Refreshed> {
  const policy = RESOURCE_POLICIES[resource];
  const sharedKey = `tarkov:${SHARED_KEY_VERSION}:${gameMode}/${resource}`;
  if (policy.shared) {
    const shared = await readShared(sharedKey, resource, entry, policy);
    if (shared) return shared;
  }
  const previous = entry.value
    ? { value: entry.value, etag: entry.etag, lastModified: entry.lastModified }
    : undefined;
  const fetched = await fetchWithRetries(gameMode, resource, attempts, previous);
  const checkedAt = Date.now();
  if (fetched.notModified) {
    // fetchResource only accepts a 304 when it sent validators, which needs a previous copy.
    const refreshed = { ...previous!, checkedAt };
    if (policy.shared) await writeShared(sharedKey, refreshed, policy, false);
    return refreshed;
  }
  const refreshed = { value: fetched.value, etag: fetched.etag, lastModified: fetched.lastModified, checkedAt };
  if (policy.shared && fetched.chars <= SHARED_MAX_CHARS) {
    await writeShared(sharedKey, refreshed, policy, true);
  }
  return refreshed;
}

async function readShared(
  key: string,
  resource: Resource,
  entry: ResourceCacheEntry,
  policy: ResourcePolicy
): Promise<Refreshed | null> {
  const cache = regionalCache();
  const meta = readSharedMeta(await cache.get(`${key}:meta`));
  const now = Date.now();
  // Allow for another instance's clock running slightly ahead.
  if (!meta || now - meta.checkedAt >= policy.freshMs || meta.checkedAt - now > MINUTE_MS) return null;
  const checkedAt = Math.min(meta.checkedAt, now);
  const version = meta.etag ?? meta.lastModified;
  if (entry.value && version === (entry.etag ?? entry.lastModified)) {
    return { value: entry.value, etag: entry.etag, lastModified: entry.lastModified, checkedAt };
  }
  const body = await cache.get(`${key}:body:${version}`);
  if (!isRecord(body) || !("data" in body) || !validateResourceData(resource, body.data)) return null;
  return {
    value: body as unknown as UpstreamEnvelope<unknown>,
    etag: meta.etag,
    lastModified: meta.lastModified,
    checkedAt,
  };
}

function readSharedMeta(value: unknown): SharedMeta | null {
  if (!isRecord(value) || typeof value.checkedAt !== "number" || !Number.isFinite(value.checkedAt)) return null;
  const etag = typeof value.etag === "string" ? value.etag : undefined;
  const lastModified = typeof value.lastModified === "string" ? value.lastModified : undefined;
  return etag || lastModified ? { etag, lastModified, checkedAt: value.checkedAt } : null;
}

// Share only versioned bodies; update metadata separately to avoid rewriting unchanged data.
async function writeShared(key: string, refreshed: Refreshed, policy: ResourcePolicy, withBody: boolean) {
  const version = refreshed.etag ?? refreshed.lastModified;
  if (!version) return;
  const cache = regionalCache();
  if (withBody) await cache.set(`${key}:body:${version}`, refreshed.value, SHARED_BODY_TTL_SECONDS);
  const meta: SharedMeta = { etag: refreshed.etag, lastModified: refreshed.lastModified, checkedAt: refreshed.checkedAt };
  await cache.set(`${key}:meta`, meta, Math.ceil(policy.revalidateMs / 1000));
}

// Shared like the resource cache, so the limit holds per instance, not per bundled copy of this module.
const UPSTREAM_SLOTS_KEY = "__eftTarkovUpstreamSlots:1";
const upstreamSlots = ((globalThis as typeof globalThis & {
  [UPSTREAM_SLOTS_KEY]?: { active: number; queue: Array<() => void> };
})[UPSTREAM_SLOTS_KEY] ??= { active: 0, queue: [] });

async function withUpstreamSlot<T>(work: () => Promise<T>): Promise<T> {
  if (upstreamSlots.active < MAX_UPSTREAM_REQUESTS) upstreamSlots.active += 1;
  else await new Promise<void>((resolve) => upstreamSlots.queue.push(resolve));
  try {
    return await work();
  } finally {
    const next = upstreamSlots.queue.shift();
    if (next) next();
    else upstreamSlots.active -= 1;
  }
}

async function loadRelations(gameMode: GameMode): Promise<RelationsContext> {
  const [bartersEnvelope, craftsEnvelope] = await Promise.all([
    loadResource<RawBarter[]>(gameMode, "barters"),
    loadResource<RawCraft[]>(gameMode, "crafts"),
  ]);
  return memo(`${gameMode}/relations-context`, [bartersEnvelope, craftsEnvelope], () => {
    const bartersByItem = new Map<string, RawBarter[]>();
    const bartersByReward = new Map<string, RawBarter[]>();
    const craftsByItem = new Map<string, RawCraft[]>();
    const craftsByReward = new Map<string, RawCraft[]>();
    for (const barter of bartersEnvelope.data) {
      indexRelation(bartersByItem, barter.requiredItems, barter);
      indexRelation(bartersByReward, barter.offeredItem ? [barter.offeredItem] : [], barter);
    }
    for (const craft of craftsEnvelope.data) {
      indexRelation(craftsByItem, craft.requiredItems, craft);
      indexRelation(craftsByReward, craft.productItem ? [craft.productItem] : [], craft);
    }
    return { bartersByItem, bartersByReward, craftsByItem, craftsByReward };
  });
}

function indexRelation<T>(
  index: Map<string, T[]>,
  requiredItems: RawContainedItem[] | null | undefined,
  relation: T
) {
  for (const id of new Set((requiredItems ?? []).flatMap((entry) => entry.item ? [entry.item] : []))) {
    const matches = index.get(id) ?? [];
    matches.push(relation);
    index.set(id, matches);
  }
}

type Fetched =
  | { notModified: true }
  | {
      notModified: false;
      value: UpstreamEnvelope<unknown>;
      etag?: string;
      lastModified?: string;
      chars: number;
    };

async function fetchResource(
  gameMode: GameMode,
  resource: Resource,
  validators?: { etag?: string; lastModified?: string }
): Promise<Fetched> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  // Node's fetch asks for gzip and deflate unless told otherwise; it decodes brotli all the same.
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "br, gzip",
    "User-Agent": USER_AGENT,
  };
  if (validators?.etag) headers["If-None-Match"] = validators.etag;
  if (validators?.lastModified) headers["If-Modified-Since"] = validators.lastModified;
  const conditional = "If-None-Match" in headers || "If-Modified-Since" in headers;
  try {
    const response = await fetch(`${UPSTREAM_BASE_URL}/${gameMode}/${resource}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 304 && conditional) {
      // Not awaited: a cancel can wait on a reader that never comes.
      void response.body?.cancel().catch(() => undefined);
      return { notModified: true };
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new TarkovUpstreamError(
        `Tarkov.dev returned ${response.status} for ${resource}.`,
        response.status,
        parseRetryAfter(response.headers.get("retry-after"))
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > UPSTREAM_MAX_BYTES) {
      throw new TarkovUpstreamError(`Tarkov.dev returned an oversized ${resource} payload.`, undefined, undefined, true);
    }
    const { json, chars } = await readJsonWithLimit(response, resource);
    if (!isRecord(json) || !("data" in json) || !validateResourceData(resource, json.data)) {
      throw new TarkovUpstreamError(`Tarkov.dev returned invalid ${resource} data.`, undefined, undefined, true);
    }
    return {
      notModified: false,
      value: json as unknown as UpstreamEnvelope<unknown>,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      chars,
    };
  } catch (error) {
    // Checked first: a timeout while reading the body surfaces as unreadable JSON.
    if (controller.signal.aborted) {
      throw new TarkovUpstreamError(`Tarkov.dev timed out while loading ${resource}.`, undefined, undefined, false, true);
    }
    if (error instanceof TarkovUpstreamError) throw error;
    throw new TarkovUpstreamError(
      error instanceof Error
        ? `Tarkov.dev failed while loading ${resource}: ${error.message}`
        : `Tarkov.dev failed while loading ${resource}.`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function readJsonWithLimit(
  response: Response,
  resource: Resource
): Promise<{ json: unknown; chars: number }> {
  if (!response.body) {
    throw new TarkovUpstreamError(`Tarkov.dev returned an empty ${resource} payload.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > UPSTREAM_MAX_BYTES) {
        await reader.cancel("Payload exceeded the configured limit.");
        throw new TarkovUpstreamError(`Tarkov.dev returned an oversized ${resource} payload.`, undefined, undefined, true);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const text = chunks.join("");
    return { json: JSON.parse(text) as unknown, chars: text.length };
  } catch (error) {
    if (error instanceof TarkovUpstreamError) throw error;
    throw new TarkovUpstreamError(`Tarkov.dev returned invalid ${resource} JSON.`);
  } finally {
    reader.releaseLock();
  }
}

function validateResourceData(resource: Resource, data: unknown): boolean {
  switch (resource) {
    case "items":
      return (
        isRecord(data) &&
        optionalDictionary(data.items, isRawItem) &&
        optionalDictionary(data.itemCategories, isRawCategory) &&
        optionalDictionary(data.handbookCategories, isRawCategory) &&
        optional(data.fleaMarket, (value) =>
          isRecord(value) &&
          optionalFiniteNumber(value.sellOfferFeeRate) &&
          optionalFiniteNumber(value.sellRequirementFeeRate)
        )
      );
    case "tasks":
      return (
        isRecord(data) &&
        optionalDictionary(data.tasks, isRawTask) &&
        optionalDictionary(data.questItems, (item) =>
          isRecord(item) && [item.name, item.shortName, item.gridImageLink].every(optionalShortString)
        ) &&
        optionalArray(data.prestige, (entry) =>
          isRecord(entry) && optionalShortString(entry.id) && optionalFiniteNumber(entry.prestigeLevel)
        )
      );
    case "maps":
      return (
        isRecord(data) &&
        optionalDictionary(data.maps, isRawMap) &&
        optionalDictionary(data.lootContainers, isRawNamedEntity) &&
        optionalDictionary(data.stationaryWeapons, isRawNamedEntity) &&
        optional(data.mobs, isRecord)
      );
    case "barters":
      return boundedArray(data, isRawBarter, MAX_RESOURCE_RECORDS);
    case "crafts":
      return boundedArray(data, isRawCraft, MAX_RESOURCE_RECORDS);
    case "traders":
      return dictionary(data, isRawNamedEntity);
    case "hideout":
      return dictionary(data, isRawHideoutStation);
    case "items_en":
    case "tasks_en":
    case "traders_en":
    case "hideout_en":
    case "maps_en":
      return dictionary(data, isShortString);
  }
}

function isRawItem(value: unknown): value is RawItem {
  if (!isRecord(value)) return false;
  const stringFields = [
    value.id,
    value.normalizedName,
    value.name,
    value.shortName,
    value.gridImageLink,
    value.wikiLink,
    value.description,
  ];
  const numberFields = [
    value.fleaMarketFee,
    value.minLevelForFlea,
    value.width,
    value.height,
    value.weight,
    value.basePrice,
    value.lastLowPrice,
    value.avg24hPrice,
    value.low24hPrice,
    value.high24hPrice,
    value.lastOfferCount,
    value.stackMaxSize,
    value.changeLast48hPercent,
  ];
  return (
    stringFields.every(optionalShortString) &&
    numberFields.every(optionalFiniteNumber) &&
    optionalStringArray(value.types) &&
    optionalStringArray(value.categories) &&
    optionalStringArray(value.handbookCategories) &&
    optionalArray(value.buyFromTrader, isRawTraderOffer) &&
    optionalArray(value.sellToTrader, isRawTraderOffer) &&
    optionalStringArray(value.conflictingItems) &&
    optionalStringArray(value.conflictingSlotIds) &&
    optional(value.properties, isRawItemProperties) &&
    optionalArray(value.containsItems, isRawContainedItem)
  );
}

function isRawItemProperties(value: unknown): value is RawItemProperties {
  if (!isRecord(value)) return false;
  return (
    [
      value.propertiesType,
      value.caliber,
      value.defaultAmmo,
      value.defaultPreset,
      value.baseItem,
    ].every(optionalShortString) &&
    [
      value.ergonomics,
      value.defaultWidth,
      value.defaultHeight,
      value.recoilModifier,
      value.recoilVertical,
      value.recoilHorizontal,
      value.fireRate,
      value.damage,
      value.armorDamage,
      value.penetrationPower,
      value.fragmentationChance,
      value.projectileCount,
      value.initialSpeed,
      value.accuracyModifier,
      value.capacity,
    ].every(optionalFiniteNumber) &&
    optionalStringArray(value.fireModes) &&
    optionalStringArray(value.presets) &&
    optionalStringArray(value.allowedAmmo) &&
    optionalArray(value.slots, isRawSlot)
  );
}

function isRawSlot(value: unknown): value is RawSlot {
  if (!isRecord(value)) return false;
  return (
    [value.id, value.name, value.nameId].every(optionalShortString) &&
    optionalBoolean(value.required) &&
    optional(value.filters, (filters) =>
      isRecord(filters) && optionalStringArray(filters.allowedItems)
    )
  );
}

function isRawTraderOffer(value: unknown): value is RawTraderOffer {
  return (
    isRecord(value) &&
    optionalShortString(value.trader) &&
    optionalFiniteNumber(value.priceRUB) &&
    optionalFiniteNumber(value.minTraderLevel) &&
    optionalShortString(value.taskUnlock)
  );
}

function isRawContainedItem(value: unknown): value is RawContainedItem {
  return (
    isRecord(value) &&
    optionalShortString(value.item) &&
    optionalFiniteNumber(value.count) &&
    optional(value.attributes, (attributes) => isRecord(attributes) && optionalBoolean(attributes.tool))
  );
}

function isRawTask(value: unknown): value is RawTask {
  return (
    isRecord(value) &&
    [value.id, value.name, value.normalizedName, value.wikiLink, value.trader, value.factionName].every(
      optionalShortString
    ) &&
    optionalFiniteNumber(value.minPlayerLevel) &&
    optionalArray(value.objectives, isRawTaskObjective) &&
    optionalArray(value.taskRequirements, (requirement) =>
      isRecord(requirement) && optionalShortString(requirement.task) && optionalStringArray(requirement.status)
    ) &&
    optionalArray(value.traderRequirements, (requirement) =>
      isRecord(requirement) &&
      [requirement.trader, requirement.requirementType, requirement.compareMethod].every(optionalShortString) &&
      optionalFiniteNumber(requirement.value)
    ) &&
    optionalFiniteNumber(value.experience) &&
    [value.kappaRequired, value.lightkeeperRequired, value.restartable].every(optionalBoolean) &&
    [value.taskImageLink, value.map, value.requiredPrestige].every(optionalShortString) &&
    optionalArray(value.neededKeys, (entry) =>
      isRecord(entry) && optionalShortString(entry.map) && optionalStringArray(entry.keys)
    ) &&
    optionalArray(value.failConditions, isRawTaskObjective) &&
    optional(value.startRewards, isRawTaskRewards) &&
    optional(value.finishRewards, isRawTaskRewards)
  );
}

function isRawTaskRewards(value: unknown): value is RawTaskRewards {
  return (
    isRecord(value) &&
    optionalArray(value.traderStanding, (entry) =>
      isRecord(entry) && optionalShortString(entry.trader) && optionalFiniteNumber(entry.standing)
    ) &&
    optionalArray(value.items, isRawContainedItem) &&
    optionalArray(value.offerUnlock, (entry) =>
      isRecord(entry) && [entry.trader, entry.item].every(optionalShortString) && optionalFiniteNumber(entry.level)
    ) &&
    optionalArray(value.skillLevelReward, (entry) =>
      isRecord(entry) && optionalShortString(entry.skill) && optionalFiniteNumber(entry.level)
    ) &&
    optionalStringArray(value.traderUnlock) &&
    optionalArray(value.craftUnlock, (entry) =>
      isRecord(entry) &&
      [entry.station, entry.item].every(optionalShortString) &&
      [entry.level, entry.count].every(optionalFiniteNumber)
    )
  );
}

function isRawTaskObjective(value: unknown): value is RawTaskObjective {
  if (!isRecord(value)) return false;
  return (
    [value.id, value.description, value.type, value.item, value.markerItem, value.questItem, value.task].every(
      optionalShortString
    ) &&
    optionalFiniteNumber(value.count) &&
    optionalBoolean(value.foundInRaid) &&
    optionalBoolean(value.optional) &&
    optionalStringArray(value.items) &&
    optionalStringArray(value.maps) &&
    optionalStringArray(value.useAny) &&
    optionalStringArray(value.status) &&
    optionalArray(value.requiredKeys, (group) => boundedArray(group, isShortString, MAX_NESTED_ENTRIES)) &&
    [
      value.containsAll,
      value.containsOne,
      value.wearing,
      value.usingWeapon,
      value.usingWeaponMods,
      value.notWearing,
    ].every((entry) => optional(entry, isBoundedJsonTree))
  );
}

function isRawBarter(value: unknown): value is RawBarter {
  return (
    isRecord(value) &&
    optionalShortString(value.trader) &&
    optionalShortString(value.taskUnlock) &&
    optionalFiniteNumber(value.minTraderLevel) &&
    optionalArray(value.requiredItems, isRawContainedItem) &&
    optional(value.offeredItem, isRawContainedItem)
  );
}

function isRawCraft(value: unknown): value is RawCraft {
  return (
    isRecord(value) &&
    optionalShortString(value.station) &&
    optionalShortString(value.taskUnlock) &&
    optionalFiniteNumber(value.level) &&
    optionalArray(value.requiredItems, isRawContainedItem) &&
    optional(value.productItem, isRawContainedItem)
  );
}

function isRawCategory(value: unknown): value is RawCategory {
  return (
    isRecord(value) &&
    [value.name, value.normalizedName, value.parent].every(optionalShortString)
  );
}

function isRawNamedEntity(value: unknown): value is RawNamedEntity {
  return (
    isRecord(value) &&
    [value.id, value.name, value.normalizedName].every(optionalShortString)
  );
}

function isRawHideoutStation(value: unknown): value is RawHideoutStation {
  return (
    isRawNamedEntity(value) &&
    optionalArray((value as Record<string, unknown>).levels, (level) =>
      isRecord(level) &&
      optionalFiniteNumber(level.level) &&
      optionalArray(level.itemRequirements, (requirement) =>
        isRecord(requirement) &&
        optionalShortString(requirement.item) &&
        optionalFiniteNumber(requirement.count) &&
        optional(requirement.attributes, (attributes) =>
          isRecord(attributes) && optionalBoolean(attributes.foundInRaid)
        )
      ) &&
      optionalArray(level.bonuses, (bonus) =>
        isRecord(bonus) &&
        optionalShortString(bonus.type) &&
        optionalFiniteNumber(bonus.value) &&
        optionalStringArray(bonus.slotItems)
      )
    )
  );
}

function isRawMap(value: unknown): value is RawMap {
  if (!isRecord(value)) return false;
  return (
    [value.normalizedName, value.name, value.players].every(optionalShortString) &&
    optionalFiniteNumber(value.raidDuration) &&
    optionalArray(value.extracts, (entry) =>
      isRecord(entry) &&
      [entry.id, entry.name, entry.faction].every(optionalShortString) &&
      optional(entry.position, isPosition) &&
      optionalArray(entry.outline, isOutlinePoint) &&
      optionalFiniteNumber(entry.top) &&
      optionalFiniteNumber(entry.bottom) &&
      optional(entry.transferItem, isRecord)
    ) &&
    optionalArray(value.transits, (entry) =>
      isRecord(entry) &&
      [entry.id, entry.description, entry.conditions].every(optionalShortString) &&
      optional(entry.position, isPosition) &&
      optionalArray(entry.outline, isOutlinePoint) &&
      optionalFiniteNumber(entry.top) &&
      optionalFiniteNumber(entry.bottom)
    ) &&
    optionalArray(value.spawns, (entry) =>
      isRecord(entry) &&
      optionalShortString(entry.zoneName) &&
      optional(entry.position, isPosition) &&
      optionalStringArray(entry.sides) &&
      optionalStringArray(entry.categories)
    ) &&
    optionalArray(value.locks, (entry) =>
      isRecord(entry) &&
      [entry.lockType, entry.key].every(optionalShortString) &&
      optionalBoolean(entry.needsPower) &&
      optional(entry.position, isPosition)
    ) &&
    optionalArray(value.hazards, (entry) =>
      isRecord(entry) &&
      [entry.name, entry.hazardType].every(optionalShortString) &&
      optional(entry.position, isPosition) &&
      optionalArray(entry.outline, isOutlinePoint) &&
      optionalFiniteNumber(entry.top) &&
      optionalFiniteNumber(entry.bottom)
    ) &&
    optionalArray(value.lootContainers, (entry) =>
      isRecord(entry) &&
      optional(entry.position, isPosition) &&
      optionalShortString(entry.lootContainer)
    ) &&
    optionalArray(value.switches, (entry) =>
      isRecord(entry) &&
      [entry.id, entry.name].every(optionalShortString) &&
      optional(entry.position, isPosition)
    ) &&
    optionalArray(value.stationaryWeapons, (entry) =>
      isRecord(entry) &&
      optional(entry.position, isPosition) &&
      optionalShortString(entry.stationaryWeapon)
    ) &&
    optionalArray(value.bosses, isRecord)
  );
}

function isPosition(value: unknown): value is RawPosition {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.z === "number" &&
    Number.isFinite(value.z)
  );
}

function isOutlinePoint(value: unknown): value is { x: number; z: number } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.z === "number" &&
    Number.isFinite(value.z)
  );
}

function isBoundedJsonTree(value: unknown): boolean {
  const pending = [value];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > MAX_OBJECTIVE_NODES) return false;
    if (typeof current === "string" && !isShortString(current)) return false;
    if (typeof current === "number" && !Number.isFinite(current)) return false;
    if (Array.isArray(current)) {
      if (current.length > MAX_NESTED_ENTRIES) return false;
      pending.push(...current);
    } else if (isRecord(current)) {
      const entries = Object.entries(current);
      if (entries.length > MAX_NESTED_ENTRIES) return false;
      for (const [key, entry] of entries) {
        if (!isShortString(key)) return false;
        pending.push(entry);
      }
    } else if (
      current !== null &&
      current !== undefined &&
      typeof current !== "string" &&
      typeof current !== "number" &&
      typeof current !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

function optional<T>(value: unknown, predicate: (value: unknown) => value is T): value is T | null | undefined;
function optional(value: unknown, predicate: (value: unknown) => boolean): boolean;
function optional(value: unknown, predicate: (value: unknown) => boolean) {
  return value === null || value === undefined || predicate(value);
}

function optionalArray<T>(
  value: unknown,
  predicate: (entry: unknown) => entry is T
): value is T[] | null | undefined;
function optionalArray(value: unknown, predicate: (entry: unknown) => boolean): boolean;
function optionalArray(value: unknown, predicate: (entry: unknown) => boolean) {
  return optional(value, (entry) => boundedArray(entry, predicate, MAX_NESTED_ENTRIES));
}

function boundedArray(
  value: unknown,
  predicate: (entry: unknown) => boolean,
  maxEntries: number
): value is unknown[] {
  return Array.isArray(value) && value.length <= maxEntries && value.every(predicate);
}

function dictionary(
  value: unknown,
  predicate: (entry: unknown) => boolean
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_RESOURCE_RECORDS &&
    entries.every(([key, entry]) => isShortString(key) && predicate(entry))
  );
}

function optionalDictionary(
  value: unknown,
  predicate: (entry: unknown) => boolean
): boolean {
  return optional(value, (entry) => dictionary(entry, predicate));
}

function optionalStringArray(value: unknown): boolean {
  return optionalArray(value, isShortString);
}

function isShortString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_STRING_LENGTH;
}

function optionalShortString(value: unknown): boolean {
  return optional(value, isShortString);
}

function optionalBoolean(value: unknown): boolean {
  return optional(value, (entry): entry is boolean => typeof entry === "boolean");
}

function optionalFiniteNumber(value: unknown): boolean {
  return optional(value, (entry): entry is number =>
    typeof entry === "number" && Number.isFinite(entry)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function projectItemCatalog(
  items: RawItem[],
  translations: TranslationDictionary
): CatalogEntry[] {
  return items.flatMap((item): CatalogEntry[] => {
    if (!item.id) return [];
    const name = translate(item.name, translations);
    if (!name) return [];
    return [[
      item.id,
      name,
      translateNullable(item.shortName, translations),
      catalogImage(item.id, item.gridImageLink),
      item.normalizedName ?? null,
    ]];
  });
}

function catalogImage(id: string, link: string | null | undefined): string | null {
  const safe = safeAssetUrl(link);
  if (!safe) return null;
  const path = new URL(safe).pathname.slice(1);
  return path === `${id}-grid-image.webp` ? "" : path;
}

function projectCachedItem(
  item: RawItem,
  name: string,
  context: OfferContext,
  usedInTasks: { name: string }[],
  fleaMarket?: ItemsData["fleaMarket"]
): CachedItem {
  const { translations, traderNames } = context;
  const fleaBuyPrice = fleaAveragePrice(item);
  const fleaSellPrice = isFleaBanned(item) ? null : finiteNumber(item.lastLowPrice);
  const canUseFlea = fleaSellPrice !== null;
  const buyFor = traderOffersOf(item, context).map(
    (offer): CachedVendorPrice => ({
      vendor: { name: offer.trader },
      priceRUB: offer.priceRUB,
      ...(offer.level === null ? {} : { minTraderLevel: offer.level }),
      ...(offer.taskUnlock ? { taskUnlock: offer.taskUnlock } : {}),
      ...(offer.preset ? { preset: offer.preset } : {}),
    })
  );
  const sellFor = projectTraderPrices(item.sellToTrader, traderNames);
  if (canUseFlea && fleaBuyPrice !== null) {
    buyFor.push({ vendor: { name: "Flea Market" }, priceRUB: fleaBuyPrice });
  }
  if (canUseFlea && fleaSellPrice !== null) {
    sellFor.push({ vendor: { name: "Flea Market" }, priceRUB: fleaSellPrice });
  }
  return {
    id: item.id ?? "",
    normalizedName: item.normalizedName ?? "",
    name,
    shortName: translateNullable(item.shortName, translations),
    gridImageLink: safeAssetUrl(item.gridImageLink),
    wikiLink: safeHttpsUrl(item.wikiLink),
    fleaMarketFee:
      finiteNumber(item.fleaMarketFee) ?? calculateFleaMarketFee(item, fleaMarket),
    width: positiveFiniteNumber(item.width) ?? 1,
    height: positiveFiniteNumber(item.height) ?? 1,
    changeLast48hPercent: finiteNumber(item.changeLast48hPercent),
    buyFor,
    sellFor,
    usedInTasks,
    fleaBanned: isFleaBanned(item),
    fleaMinLevel: finiteNumber(item.minLevelForFlea),
    ...(item.properties?.propertiesType === "ItemPropertiesWeapon"
      ? {
          weapon: {
            defaultWidth: positiveFiniteNumber(item.properties.defaultWidth),
            defaultHeight: positiveFiniteNumber(item.properties.defaultHeight),
          },
        }
      : {}),
  };
}

function projectTraderPrices(offers: RawTraderOffer[] | null | undefined, traderNames: Map<string, string>) {
  return (offers ?? []).flatMap((offer) => {
    const priceRUB = finiteNumber(offer.priceRUB);
    if (!offer.trader || priceRUB === null) return [];
    return [{ vendor: { name: traderNames.get(offer.trader) ?? offer.trader }, priceRUB }];
  });
}

function projectTask(
  task: RawTask,
  objectives: RawTaskObjective[],
  translations: TranslationDictionary,
  traderNames: Map<string, string>
): CachedTask {
  const faction = task.factionName && task.factionName !== "Any" ? task.factionName : null;
  return {
    name: translate(task.name, translations),
    minPlayerLevel: finiteNumber(task.minPlayerLevel) ?? 0,
    wikiLink: safeHttpsUrl(task.wikiLink),
    trader: { name: (task.trader && traderNames.get(task.trader)) || task.trader || "Unknown" },
    faction,
    objectives: objectives.map((objective) => ({
      description: translateNullable(objective.description, translations),
      type: objective.type ?? null,
      count: finiteNumber(objective.count),
      foundInRaid: typeof objective.foundInRaid === "boolean" ? objective.foundInRaid : null,
      optional: objective.optional === true,
      alternatives: Math.max(0, objectiveItemIds(objective).size - 1),
    })),
  };
}

function projectBarter(
  barter: RawBarter,
  itemById: Map<string, RawItem>,
  itemTranslations: TranslationDictionary,
  traderNames: Map<string, string>,
  taskById: Map<string, RawTask>,
  taskTranslations: TranslationDictionary
): CachedBarter {
  return {
    trader: {
      name: (barter.trader && traderNames.get(barter.trader)) || barter.trader || "Unknown",
    },
    level: finiteNumber(barter.minTraderLevel) ?? 0,
    taskUnlock: projectTaskUnlock(barter.taskUnlock, taskById, taskTranslations),
    requiredItems: projectContainedItems(barter.requiredItems, itemById, itemTranslations),
    rewardItems: projectContainedItems(
      barter.offeredItem ? [barter.offeredItem] : [],
      itemById,
      itemTranslations
    ),
  };
}

function projectCraft(
  craft: RawCraft,
  itemById: Map<string, RawItem>,
  itemTranslations: TranslationDictionary,
  stationNames: Map<string, string>,
  taskById: Map<string, RawTask>,
  taskTranslations: TranslationDictionary
): CachedCraft {
  return {
    station: {
      name: (craft.station && stationNames.get(craft.station)) || craft.station || "Unknown",
    },
    level: finiteNumber(craft.level) ?? 0,
    taskUnlock: projectTaskUnlock(craft.taskUnlock, taskById, taskTranslations),
    requiredItems: projectContainedItems(craft.requiredItems, itemById, itemTranslations, true),
    rewardItems: projectContainedItems(
      craft.productItem ? [craft.productItem] : [],
      itemById,
      itemTranslations
    ),
  };
}

function projectTaskUnlock(
  taskId: string | null | undefined,
  taskById: Map<string, RawTask>,
  translations: TranslationDictionary
) {
  if (!taskId) return null;
  const task = taskById.get(taskId);
  if (!task) return null;
  return {
    name: translate(task.name, translations),
    wikiLink: safeHttpsUrl(task.wikiLink),
  };
}

function projectContainedItems(
  entries: RawContainedItem[] | null | undefined,
  itemById: Map<string, RawItem>,
  translations: TranslationDictionary,
  markTools = false
): CachedContainedItem[] {
  return (entries ?? []).flatMap((entry) => {
    if (!entry.item) return [];
    const item = itemById.get(entry.item);
    return [
      {
        item: {
          name: item ? translate(item.name, translations) : entry.item,
          normalizedName: item?.normalizedName ?? null,
        },
        quantity: finiteNumber(entry.count) ?? 0,
        ...(markTools && entry.attributes?.tool === true ? { tool: true } : {}),
      },
    ];
  });
}

function indexTasksByItem(tasks: RawTask[]) {
  const index = new Map<string, TaskItemUse[]>();
  for (const task of tasks) {
    const objectivesByItem = new Map<string, RawTaskObjective[]>();
    for (const objective of task.objectives ?? []) {
      for (const itemId of objectiveItemIds(objective)) {
        const objectives = objectivesByItem.get(itemId) ?? [];
        objectives.push(objective);
        objectivesByItem.set(itemId, objectives);
      }
    }
    for (const [itemId, objectives] of objectivesByItem) {
      const matches = index.get(itemId) ?? [];
      matches.push({ task, objectives });
      index.set(itemId, matches);
    }
  }
  return index;
}

/** Item IDs an objective specifically needs; empty for objectives any item satisfies. */
function objectiveItemIds(objective: RawTaskObjective) {
  const itemIds = new Set<string>();
  collectItemIds(objective.item, itemIds);
  collectItemIds(objective.items, itemIds);
  collectItemIds(objective.markerItem, itemIds);
  collectItemIds(objective.containsOne, itemIds);
  collectItemIds(objective.containsAll, itemIds);
  collectItemIds(objective.wearing, itemIds);
  collectItemIds(objective.usingWeapon, itemIds);
  collectItemIds(objective.usingWeaponMods, itemIds);
  return itemIds.size > MAX_ITEM_SPECIFIC_OBJECTIVE_IDS ? new Set<string>() : itemIds;
}

function collectItemIds(value: unknown, ids: Set<string>) {
  const pending = [value];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_OBJECTIVE_NODES) {
    const current = pending.pop();
    visited += 1;
    if (typeof current === "string") {
      ids.add(current);
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (isRecord(current)) {
      if (typeof current.id === "string") ids.add(current.id);
      if (typeof current.item === "string") ids.add(current.item);
      pending.push(...Object.values(current));
    }
  }
}

const DOGTAG_IDS = new Set([
  "59f32bb586f774757e1e8442",
  "59f32c3b86f77472a31742f0",
  "5b9b9020e7ef6f5716480215",
]);
const BOTH_DOGTAGS_ID = "5b9b9020e7ef6f5716480215";

function relatedBarters(index: Map<string, RawBarter[]>, requestedId: string) {
  const ids = new Set([requestedId]);
  if (DOGTAG_IDS.has(requestedId)) ids.add(BOTH_DOGTAGS_ID);
  if (requestedId === BOTH_DOGTAGS_ID) {
    for (const id of DOGTAG_IDS) ids.add(id);
  }
  const result = new Set<RawBarter>();
  for (const id of ids) {
    for (const barter of index.get(id) ?? []) result.add(barter);
  }
  return Array.from(result);
}

function projectBuildItem(item: RawItem, context: OfferContext): BuildItemData {
  const { itemById, translations } = context;
  const properties = item.properties;
  const isWeapon = properties?.propertiesType === "ItemPropertiesWeapon";
  return {
    id: item.id ?? "",
    name: translate(item.name, translations),
    shortName: translate(item.shortName, translations) || translate(item.name, translations),
    gridImageLink: safeAssetUrl(item.gridImageLink),
    weight: finiteNumber(item.weight) ?? 0,
    ...traderDetails(item, context),
    fleaPriceRUB: fleaAveragePrice(item),
    ergonomics: finiteNumber(properties?.ergonomics) ?? 0,
    recoilModifier: isWeapon ? 0 : finiteNumber(properties?.recoilModifier) ?? 0,
    recoilVertical: isWeapon ? finiteNumber(properties?.recoilVertical) : null,
    recoilHorizontal: isWeapon ? finiteNumber(properties?.recoilHorizontal) : null,
    isWeapon,
    caliber: properties?.caliber ?? null,
    fireRate: finiteNumber(properties?.fireRate),
    fireModes: (properties?.fireModes ?? []).map((mode) => translate(mode, translations)),
    defaultAmmoName:
      (properties?.defaultAmmo &&
        translate(itemById.get(properties.defaultAmmo)?.name, translations)) ||
      null,
    defaultPresetId: properties?.defaultPreset ?? null,
    presets: (properties?.presets ?? []).flatMap((id) => {
      const preset = itemById.get(id);
      return preset ? [{ id, name: translate(preset.name, translations) }] : [];
    }),
    conflictingItemIds: item.conflictingItems ?? [],
    conflictingSlotIds: item.conflictingSlotIds ?? [],
    slots: projectSlots(properties?.slots, translations),
    allowedAmmoIds: (properties?.allowedAmmo ?? []).filter((id) => byIdHasAmmo(itemById, id)),
    ...gunBuilderExtras(item, context),
    capacity:
      properties?.propertiesType === "ItemPropertiesMagazine" ? positiveFiniteNumber(properties.capacity) : null,
    sight: sightKind(item, translate(item.name, translations)),
    ...sightingRangeOf(properties),
  };
}

function sightingRangeOf(properties: RawItemProperties | null | undefined): { sightingRange?: number } {
  const range = positiveFiniteNumber(properties?.sightingRange);
  return range === null ? {} : { sightingRange: range };
}

// tarkov.dev item category for iron sights; other items with scope properties are optics.
const IRON_SIGHT_CATEGORY = "55818ac54bdc2d5b648b456e";

function sightKind(item: RawItem, name: string): SightKind | null {
  if (item.properties?.propertiesType === "ItemPropertiesScope") {
    return item.categories?.includes(IRON_SIGHT_CATEGORY) ? "iron" : "optic";
  }
  // Gas blocks, barrels, and handguards with a front sight built in.
  if (/\bfront sight\b/i.test(name)) return "front";
  // Rails with both iron sights built in, such as the HK G36 optic rail with flip-up sights.
  return /\bflip-up sights\b/i.test(name) ? "iron" : null;
}

function defaultPresetOf(item: RawItem, context: OfferContext) {
  const id = item.types?.includes("gun") ? item.properties?.defaultPreset : null;
  const preset = id ? context.itemById.get(id) : undefined;
  return preset ? { item: preset, name: translate(preset.name, context.translations) || id! } : null;
}

function ownTraderOffers(item: RawItem, context: OfferContext): TraderOffer[] {
  return (item.buyFromTrader ?? []).flatMap((offer) => {
    const priceRUB = finiteNumber(offer.priceRUB);
    if (!offer.trader || priceRUB === null || priceRUB <= 0) return [];
    const taskUnlock = context.taskUnlock(offer.taskUnlock);
    return [
      {
        trader: context.traderNames.get(offer.trader) ?? offer.trader,
        priceRUB,
        level: traderLoyaltyLevel(offer),
        ...(taskUnlock ? { taskUnlock } : {}),
      },
    ];
  });
}

// Traders often sell weapons only as their default preset.
function traderOffersOf(item: RawItem, context: OfferContext): TraderOffer[] {
  const preset = defaultPresetOf(item, context);
  return [
    ...ownTraderOffers(item, context),
    ...(preset ? ownTraderOffers(preset.item, context).map((offer) => ({ ...offer, preset: preset.name })) : []),
  ].sort((a, b) => a.priceRUB - b.priceRUB);
}

const EVERY_SOURCE = { traders: true, flea: true };

// Prices are per reward item; an unpriced input makes the price null.
function barterOffersOf(item: RawItem, context: OfferContext, withInputs = false): BarterOffer[] {
  const index = context.bartersByReward;
  if (!index || !item.id) return [];
  const preset = defaultPresetOf(item, context);
  const barters = [
    ...(index.get(item.id) ?? []).map((barter) => ({ barter, preset: undefined })),
    ...(preset?.item.id ? (index.get(preset.item.id) ?? []).map((barter) => ({ barter, preset: preset.name })) : []),
  ];
  return barters
    .flatMap(({ barter, preset }) => {
      if (!barter.trader) return [];
      const requiredItems = (barter.requiredItems ?? []).flatMap((entry) => {
        if (!entry.item) return [];
        const required = context.itemById.get(entry.item);
        return [
          {
            name: (required && translate(required.name, context.translations)) || entry.item,
            count: finiteNumber(entry.count) ?? 0,
            traderOffers: required ? ownTraderOffers(required, context).sort((a, b) => a.priceRUB - b.priceRUB) : [],
            fleaPriceRUB: required ? fleaAveragePrice(required) : null,
          },
        ];
      });
      const taskUnlock = context.taskUnlock(barter.taskUnlock);
      const offer: BarterOffer = {
        trader: context.traderNames.get(barter.trader) ?? barter.trader,
        priceRUB: null,
        level: traderLoyaltyLevel(barter),
        ...(taskUnlock ? { taskUnlock } : {}),
        ...(preset ? { preset } : {}),
        requiredItems,
        count: positiveFiniteNumber(barter.offeredItem?.count) ?? 1,
      };
      offer.priceRUB = barterCost(offer, EVERY_SOURCE, null);
      if (!withInputs) offer.requiredItems = requiredItems.map(({ name, count }) => ({ name, count }));
      return [offer];
    })
    .sort((a, b) => (a.priceRUB ?? Number.POSITIVE_INFINITY) - (b.priceRUB ?? Number.POSITIVE_INFINITY));
}

function gunBuilderExtras(item: RawItem, context: OfferContext) {
  const extras = { traderOffers: traderOffersOf(item, context), fleaBanned: isFleaBanned(item) };
  if (!context.bartersByReward) return extras;
  const barterOffers = barterOffersOf(item, context, true);
  return { ...extras, barterOffers, barterPriceRUB: barterOffers[0]?.priceRUB ?? null };
}

function byIdHasAmmo(itemById: Map<string, RawItem>, id: string) {
  return itemById.get(id)?.properties?.propertiesType === "ItemPropertiesAmmo";
}

function projectAmmoItem(item: RawItem, context: OfferContext): AmmoItemData {
  const { translations } = context;
  const properties = item.properties;
  return {
    id: item.id ?? "",
    ...traderDetails(item, context),
    normalizedName: item.normalizedName ?? "",
    name: translate(item.name, translations),
    shortName: translate(item.shortName, translations) || translate(item.name, translations),
    gridImageLink: safeAssetUrl(item.gridImageLink),
    caliber: properties?.caliber ?? null,
    damage: finiteNumber(properties?.damage) ?? 0,
    penetrationPower: finiteNumber(properties?.penetrationPower) ?? 0,
    armorDamage: finiteNumber(properties?.armorDamage) ?? 0,
    fragmentationChance: finiteNumber(properties?.fragmentationChance) ?? 0,
    projectileCount: positiveFiniteNumber(properties?.projectileCount) ?? 1,
    initialSpeed: finiteNumber(properties?.initialSpeed),
    recoilModifier: finiteNumber(properties?.recoilModifier) ?? 0,
    accuracyModifier: finiteNumber(properties?.accuracyModifier) ?? 0,
    fleaPriceRUB: fleaAveragePrice(item),
    ...gunBuilderExtras(item, context),
  };
}

function projectPickItem(item: RawItem, context: OfferContext): PickItemData {
  const { translations } = context;
  return {
    id: item.id ?? "",
    name: translate(item.name, translations),
    shortName: translate(item.shortName, translations) || translate(item.name, translations),
    gridImageLink: safeAssetUrl(item.gridImageLink),
    weight: finiteNumber(item.weight) ?? 0,
    ...traderDetails(item, context),
    fleaPriceRUB: fleaAveragePrice(item),
    ergonomics: finiteNumber(item.properties?.ergonomics) ?? 0,
    recoilModifier: finiteNumber(item.properties?.recoilModifier) ?? 0,
    conflictingItemIds: item.conflictingItems ?? [],
    conflictingSlotIds: item.conflictingSlotIds ?? [],
  };
}

function projectSlots(
  slots: RawSlot[] | null | undefined,
  translations: TranslationDictionary
): ModSlotDef[] {
  return (slots ?? []).flatMap((slot) => {
    if (!slot.id) return [];
    return [
      {
        id: slot.id,
        name: translate(slot.name, translations) || slot.nameId || slot.id,
        nameId: slot.nameId ?? slot.id,
        required: Boolean(slot.required),
        allowedItemIds: slot.filters?.allowedItems ?? [],
      },
    ];
  });
}

function traderDetails(item: RawItem, context: OfferContext) {
  const [best] = traderOffersOf(item, context);
  return {
    normalizedName: item.normalizedName ?? "",
    traderPriceRUB: best?.priceRUB ?? null,
    traderName: best?.trader ?? null,
    traderLevel: best?.level ?? null,
    ...(best?.taskUnlock ? { traderTask: best.taskUnlock.name } : {}),
  };
}

/**
 * The one test for flea eligibility: tarkov.dev's noFlea type. Item pages, price lists, and
 * the gun builder all read it from here, so they never disagree about a ban.
 */
function isFleaBanned(item: RawItem) {
  return Boolean(item.types?.includes("noFlea"));
}

/** The 24-hour flea average (or the lowest listing without one); null when the item can't be traded there. */
function fleaAveragePrice(item: RawItem) {
  if (isFleaBanned(item)) return null;
  return finiteNumber(item.avg24hPrice) ?? finiteNumber(item.lastLowPrice);
}

/** A trader offer's loyalty level, 1 to 10, or null when tarkov.dev gives none or an odd value. */
function traderLoyaltyLevel(offer: { minTraderLevel?: number | null }) {
  const level = finiteNumber(offer.minTraderLevel);
  return level !== null && Number.isInteger(level) && level >= 1 && level <= 10 ? level : null;
}

const EXTRACT_FACTIONS: ExtractFaction[] = ["pmc", "scav", "shared"];

function projectMap(
  key: string,
  raw: RawMap,
  translations: TranslationDictionary,
  lootContainerById: Dictionary<RawNamedEntity>,
  stationaryWeaponById: Dictionary<RawNamedEntity>,
  itemNames: Map<string, string>,
  itemById: Map<string, RawItem>,
  mobs: Record<string, unknown>
): MapDetails {
  const spawns: MapSpawn[] = [];
  for (const spawn of raw.spawns ?? []) {
    if (!spawn.position) continue;
    const kind = spawnKind(spawn.sides, spawn.categories);
    if (!kind) continue;
    const zoneLabel = spawn.zoneName ? translations[spawn.zoneName] : undefined;
    spawns.push({
      zoneName: spawn.zoneName ?? null,
      ...(zoneLabel ? { zoneLabel } : {}),
      kind,
      position: spawn.position,
    });
  }

  return {
    key,
    players: raw.players ?? null,
    raidDuration: finiteNumber(raw.raidDuration),
    extracts: (raw.extracts ?? []).flatMap((extract) => {
      if (!extract.position || !extract.id) return [];
      return [
        {
          id: extract.id,
          name: translate(extract.name, translations) || "Extract",
          faction: EXTRACT_FACTIONS.includes(extract.faction as ExtractFaction)
            ? (extract.faction as ExtractFaction)
            : "shared",
          position: extract.position,
          outline: extract.outline ?? [],
          top: finiteNumber(extract.top),
          bottom: finiteNumber(extract.bottom),
          transferItem: projectTransferItem(extract.transferItem, itemNames),
        },
      ];
    }),
    transits: (raw.transits ?? []).flatMap((transit) => {
      if (!transit.position || !transit.id) return [];
      return [
        {
          id: transit.id,
          description: translate(transit.description, translations) || "Transit",
          position: transit.position,
          outline: transit.outline ?? [],
          top: finiteNumber(transit.top),
          bottom: finiteNumber(transit.bottom),
          conditions: translate(transit.conditions, translations) || null,
        },
      ];
    }),
    spawns,
    locks: (raw.locks ?? []).flatMap((lock) =>
      lock.position
        ? [
            {
              lockType: lock.lockType ?? "door",
              needsPower: Boolean(lock.needsPower),
              position: lock.position,
              keyName: (lock.key && itemNames.get(lock.key)) || null,
              keyNormalizedName: (lock.key && itemById.get(lock.key)?.normalizedName) || null,
            },
          ]
        : []
    ),
    hazards: (raw.hazards ?? []).flatMap((hazard) =>
      hazard.position
        ? [
            {
              name: translate(hazard.name, translations) || "Hazard",
              hazardType: hazard.hazardType ?? null,
              position: hazard.position,
              outline: hazard.outline ?? [],
              top: finiteNumber(hazard.top),
              bottom: finiteNumber(hazard.bottom),
            },
          ]
        : []
    ),
    lootContainers: (raw.lootContainers ?? []).flatMap((container) => {
      if (!container.position || !container.lootContainer) return [];
      const type = lootContainerById[container.lootContainer];
      const normalizedName = type?.normalizedName ?? container.lootContainer;
      return [
        {
          typeId: normalizedName,
          typeName: translate(type?.name, translations) || normalizedName,
          position: container.position,
        },
      ];
    }),
    switches: (raw.switches ?? []).flatMap((mapSwitch) =>
      mapSwitch.position && mapSwitch.id
        ? [
            {
              id: mapSwitch.id,
              name: translateNullable(mapSwitch.name, translations),
              position: mapSwitch.position,
            },
          ]
        : []
    ),
    stationaryWeapons: (raw.stationaryWeapons ?? []).flatMap((weapon) => {
      if (!weapon.position || !weapon.stationaryWeapon) return [];
      const type = stationaryWeaponById[weapon.stationaryWeapon];
      return [
        {
          name: translate(type?.name, translations) || "Stationary weapon",
          position: weapon.position,
        },
      ];
    }),
    bosses: projectBosses(raw.bosses ?? [], translations, mobs),
  };
}

function projectTransferItem(
  value: { item?: unknown; count?: unknown } | null | undefined,
  itemNames: Map<string, string>
) {
  if (!value || typeof value.item !== "string") return null;
  const count = finiteNumber(value.count);
  return { name: itemNames.get(value.item) ?? value.item, count: count ?? 1 };
}

const MAX_BOSS_LOCATIONS = 20;

/**
 * A mob name tarkov.dev left untranslated, such as "infectedScreamer", as words: "Infected
 * screamer". Translated names are kept as they are.
 */
export function readableMobName(name: string) {
  if (!/^[a-z]+(?:[A-Z][a-z]+)+$/.test(name)) return name;
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Boss spawns with translated names; entries in an unexpected shape are skipped. */
function projectBosses(
  bosses: Record<string, unknown>[],
  translations: TranslationDictionary,
  mobs: Record<string, unknown>
): MapBoss[] {
  return bosses.flatMap((boss): MapBoss[] => {
    const mobId = typeof boss.mob === "string" ? boss.mob : null;
    const spawnChance = finiteNumber(boss.spawnChance);
    if (!mobId || spawnChance === null) return [];
    const mob = mobs[mobId];
    const mobName = isRecord(mob) && typeof mob.name === "string" ? mob.name : mobId;
    const locations = (Array.isArray(boss.spawnLocations) ? boss.spawnLocations : [])
      .slice(0, MAX_BOSS_LOCATIONS)
      .flatMap((location) => {
        if (!isRecord(location) || typeof location.name !== "string") return [];
        return [
          {
            zone: location.name,
            name: translate(location.name, translations),
            chance: finiteNumber(location.chance) ?? 0,
          },
        ];
      });
    const escorts = (Array.isArray(boss.escorts) ? boss.escorts : []).reduce<number>((total, escort) => {
      if (!isRecord(escort) || !Array.isArray(escort.amount)) return total;
      const counts = escort.amount.map((amount) => (isRecord(amount) ? finiteNumber(amount.count) ?? 0 : 0));
      return total + Math.max(0, ...counts);
    }, 0);
    const spawnTime = finiteNumber(boss.spawnTime);
    return [
      {
        name: readableMobName(translate(mobName, translations)),
        spawnChance,
        locations,
        escorts,
        spawnTimeSeconds: spawnTime !== null && spawnTime >= 0 ? spawnTime : null,
        trigger: typeof boss.spawnTrigger === "string" && isShortString(boss.spawnTrigger) ? boss.spawnTrigger : null,
      },
    ];
  });
}

function spawnKind(
  sides: string[] | null | undefined,
  categories: string[] | null | undefined
): SpawnKind | null {
  const categorySet = categories ?? [];
  if (categorySet.includes("boss")) return "boss";
  if (categorySet.includes("sniper")) return "sniper";
  if (
    categorySet.includes("player") &&
    (sides ?? []).some((side) => side === "pmc" || side === "all")
  ) {
    return "pmc";
  }
  if (categorySet.includes("botpmc")) return "raider";
  if (categorySet.includes("bot") || categorySet.includes("all")) return "scav";
  return null;
}

function translate(value: string | null | undefined, translations: TranslationDictionary) {
  if (!value) return "";
  return translations[value] ?? value;
}

function translateNullable(
  value: string | null | undefined,
  translations: TranslationDictionary
) {
  if (value === null || value === undefined) return null;
  return translate(value, translations);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeAssetUrl(value: unknown): string | null {
  const safe = safeHttpsUrl(value);
  if (!safe) return null;
  return new URL(safe).hostname === "assets.tarkov.dev" ? safe : null;
}

function calculateFleaMarketFee(
  item: RawItem,
  fleaMarket: ItemsData["fleaMarket"]
): number | null {
  if (isFleaBanned(item)) return null;
  const basePrice = finiteNumber(item.basePrice);
  const listingPrice = finiteNumber(item.lastLowPrice) ?? basePrice;
  const offerRate = finiteNumber(fleaMarket?.sellOfferFeeRate);
  const requirementRate = finiteNumber(fleaMarket?.sellRequirementFeeRate);
  if (
    basePrice === null ||
    basePrice <= 0 ||
    listingPrice === null ||
    listingPrice <= 0 ||
    offerRate === null ||
    requirementRate === null
  ) {
    return null;
  }

  let offerExponent = Math.log10(basePrice / listingPrice);
  if (listingPrice < basePrice) offerExponent = Math.pow(offerExponent, 1.08);
  let requirementExponent = Math.log10(listingPrice / basePrice);
  if (listingPrice >= basePrice) {
    requirementExponent = Math.pow(requirementExponent, 1.08);
  }
  const fee =
    basePrice * offerRate * Math.pow(4, offerExponent) +
    listingPrice * requirementRate * Math.pow(4, requirementExponent);
  return Math.round(
    Math.min(Number.MAX_SAFE_INTEGER, Math.max(Number.MIN_SAFE_INTEGER, fee))
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TarkovRequestError("Variables must be an object.");
  }
  return value as Record<string, unknown>;
}

function readGameMode(input: Record<string, unknown>): GameMode {
  if (input.gameMode === "regular" || input.gameMode === "pve") return input.gameMode;
  throw new TarkovRequestError("gameMode must be regular or pve.");
}

function readString(value: unknown, name: string, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TarkovRequestError(`${name} must be a non-empty string.`);
  }
  return value;
}

function readStringList(value: unknown, name: string, maxItems: number) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TarkovRequestError(`${name} must be an array with at most ${maxItems} entries.`);
  }
  const strings = value.map((entry) => readString(entry, name, 500));
  return Array.from(new Set(strings));
}

/** Waits until no refresh is running, including ones started while waiting. For tests. */
export async function settleTarkovRefreshes() {
  for (;;) {
    const running = [...resourceCache.values()].flatMap((entry) => (entry.inFlight ? [entry.inFlight] : []));
    if (running.length === 0) return;
    await Promise.allSettled(running);
  }
}

export function clearTarkovResourceCache() {
  resourceCache.clear();
  memoCache.clear();
}

export async function listItemSlugs(gameMode: GameMode = "regular") {
  const context = await loadItems(gameMode);
  return memo(`${gameMode}/slugs`, [context], () => listedSlugs(context));
}

function listedSlugs(context: ItemsContext) {
  return Array.from(context.bySlug.keys()).filter((slug) => /^[a-z0-9][a-z0-9-]*$/.test(slug));
}

export interface ItemPageIndex {
  /** Every item page: its indexing and when tarkov.dev last updated its data (null when unknown). */
  pages: Map<string, { indexing: ItemIndexing; updated: string | null }>;
  /** When tarkov.dev last published the items data, as an ISO time; null when unknown. */
  publishedAt: string | null;
}

/** Each item page's indexing (see itemIndexing), for the sitemap and the item page's metadata. */
export async function getItemPageIndex(gameMode: GameMode = "regular"): Promise<ItemPageIndex> {
  const context = await loadItems(gameMode);
  const pages = memo(`${gameMode}/item-page-index`, [context], () => {
    const slugs = new Set(listedSlugs(context));
    const items = context.items.flatMap((item): IndexableItem[] =>
      item.id && item.normalizedName && slugs.has(item.normalizedName)
        ? [
            {
              id: item.id,
              slug: item.normalizedName,
              name: translate(item.name, context.translations),
              types: item.types ?? [],
              baseItemId: item.properties?.baseItem ?? null,
              tradeable: !(item.types ?? []).includes("noFlea"),
              basePrice: finiteNumber(item.basePrice),
            },
          ]
        : []
    );
    const indexing = itemIndexing(items);
    return new Map(
      items.map((item) => {
        const updated = context.byId.get(item.id)?.updated;
        return [item.slug, { indexing: indexing.get(item.slug)!, updated: isoTime(updated) }] as const;
      })
    );
  });
  return { pages, publishedAt: isoTime(resourceCache.get(`${gameMode}/items`)?.lastModified) };
}

/** When tarkov.dev last published the mode's items data, as an ISO time; null when unknown. Loads no translations or index. */
export async function itemsPublishedAt(gameMode: GameMode) {
  await loadResource(gameMode, "items");
  return isoTime(resourceCache.get(`${gameMode}/items`)?.lastModified);
}

/** An ISO time from tarkov.dev's ISO times or an HTTP date; null for anything else. */
function isoTime(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export async function warmTarkovCache(gameModes: GameMode[] = ["regular", "pve"]) {
  await Promise.allSettled(gameModes.map((gameMode) => getItemCatalog(gameMode)));
}
