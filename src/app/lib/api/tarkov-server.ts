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
  ItemUses,
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
import { barterCost } from "@/app/lib/builds/price";
import type {
  ExtractFaction,
  MapBoss,
  MapDetails,
  MapSpawn,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import { TARKOV_OPERATIONS, type TarkovOperation } from "./operations";
import { AsyncLocalStorage } from "node:async_hooks";

const UPSTREAM_BASE_URL = "https://json.tarkov.dev";
const UPSTREAM_TIMEOUT_MS = 20_000;
const UPSTREAM_MAX_BYTES = 32 * 1024 * 1024;
const RESOURCE_TTL_MS = 5 * 60_000;
const RESOURCE_REVALIDATE_MS = 30 * 60_000;
export const RESOURCE_MAX_STALE_MS = 6 * 60 * 60_000;
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
  changeLast48hPercent?: number | null;
  types?: string[] | null;
  categories?: string[] | null;
  handbookCategories?: string[] | null;
  buyFromTrader?: RawTraderOffer[] | null;
  sellToTrader?: RawTraderOffer[] | null;
  conflictingItems?: string[] | null;
  conflictingSlotIds?: string[] | null;
  properties?: RawItemProperties | null;
  containsItems?: RawContainedItem[] | null;
}

interface RawTaskObjective {
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
    position?: RawPosition | null;
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
}

interface MapsData {
  maps?: Dictionary<RawMap>;
  lootContainers?: Dictionary<RawNamedEntity>;
  stationaryWeapons?: Dictionary<RawNamedEntity>;
  mobs?: Record<string, unknown>;
}

interface ResourceCacheEntry {
  fetchedAt: number;
  value?: UpstreamEnvelope<unknown>;
  inFlight?: Promise<UpstreamEnvelope<unknown>>;
  failedAt?: number;
}

interface ItemsContext {
  items: RawItem[];
  byId: Map<string, RawItem>;
  byName: Map<string, RawItem>;
  bySlug: Map<string, RawItem>;
  nameById: Map<string, string>;
  translations: TranslationDictionary;
  fleaMarket?: ItemsData["fleaMarket"];
}

interface TasksContext {
  tasks: RawTask[];
  byId: Map<string, RawTask>;
  byItem: Map<string, TaskItemUse[]>;
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
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TarkovUpstreamError";
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
const operationContext = new AsyncLocalStorage<{
  resources: Set<ResourceCacheEntry>;
  signal?: AbortSignal;
}>();

const MAX_CONCURRENT_OPERATIONS = 16;
let activeOperations = 0;

export function tryAcquireOperationSlot() {
  if (activeOperations >= MAX_CONCURRENT_OPERATIONS) return false;
  activeOperations += 1;
  return true;
}

export function releaseOperationSlot() {
  activeOperations = Math.max(0, activeOperations - 1);
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
};

export interface TarkovReadOptions {
  signal?: AbortSignal;
  onStale?: () => void;
  onDataAge?: (ageMs: number) => void;
}

// Track cancellation and freshness for server-side reads.
export async function runTarkovRead<T>(
  work: () => Promise<T>,
  options: TarkovReadOptions = {}
): Promise<T> {
  const context = { resources: new Set<ResourceCacheEntry>(), signal: options.signal };
  return operationContext.run(context, async () => {
    options.signal?.throwIfAborted();
    const data = await waitForCaller(work(), options.signal);
    const entries = Array.from(context.resources);
    if (entries.some((entry) => entry.failedAt !== undefined)) options.onStale?.();
    const oldest = Math.min(...entries.map((entry) => entry.fetchedAt));
    if (Number.isFinite(oldest)) options.onDataAge?.(Math.max(0, Date.now() - oldest));
    return data;
  });
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
  };
  details.set(itemId, detail);
  return detail;
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
    return { items, byId, byName, bySlug, nameById, translations, fleaMarket: itemsEnvelope.data.fleaMarket };
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
  operationContext.getStore()?.resources.add(entry);

  const age = Date.now() - entry.fetchedAt;
  if (entry.value && age < RESOURCE_TTL_MS) return entry.value as UpstreamEnvelope<T>;
  if (entry.value && age < RESOURCE_REVALIDATE_MS) {
    void refreshResource(gameMode, resource, entry).catch(() => undefined);
    return entry.value as UpstreamEnvelope<T>;
  }
  return refreshResource(gameMode, resource, entry) as Promise<UpstreamEnvelope<T>>;
}

function refreshResource(gameMode: GameMode, resource: Resource, entry: ResourceCacheEntry) {
  if (entry.inFlight) return entry.inFlight;
  const inFlight = fetchResource<unknown>(gameMode, resource)
    .then((result) => {
      entry.value = result;
      entry.fetchedAt = Date.now();
      entry.failedAt = undefined;
      return result;
    })
    .catch((error: unknown) => {
      entry.failedAt = Date.now();
      if (entry.value && Date.now() - entry.fetchedAt < RESOURCE_MAX_STALE_MS) {
        console.warn(`Serving stale Tarkov ${resource} data after refresh failed.`);
        return entry.value;
      }
      throw error;
    })
    .finally(() => {
      entry.inFlight = undefined;
    });
  entry.inFlight = inFlight;
  return inFlight;
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
    for (const barter of bartersEnvelope.data) {
      indexRelation(bartersByItem, barter.requiredItems, barter);
      indexRelation(bartersByReward, barter.offeredItem ? [barter.offeredItem] : [], barter);
    }
    for (const craft of craftsEnvelope.data) indexRelation(craftsByItem, craft.requiredItems, craft);
    return { bartersByItem, bartersByReward, craftsByItem };
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

async function fetchResource<T>(gameMode: GameMode, resource: Resource) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPSTREAM_BASE_URL}/${gameMode}/${resource}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new TarkovUpstreamError(
        `Tarkov.dev returned ${response.status} for ${resource}.`,
        response.status
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > UPSTREAM_MAX_BYTES) {
      throw new TarkovUpstreamError(`Tarkov.dev returned an oversized ${resource} payload.`);
    }
    const body = await readJsonWithLimit(response, resource);
    if (!isRecord(body) || !("data" in body) || !validateResourceData(resource, body.data)) {
      throw new TarkovUpstreamError(`Tarkov.dev returned invalid ${resource} data.`);
    }
    return body as unknown as UpstreamEnvelope<T>;
  } catch (error) {
    if (error instanceof TarkovUpstreamError) throw error;
    if (controller.signal.aborted) {
      throw new TarkovUpstreamError(`Tarkov.dev timed out while loading ${resource}.`);
    }
    throw new TarkovUpstreamError(
      error instanceof Error
        ? `Tarkov.dev failed while loading ${resource}: ${error.message}`
        : `Tarkov.dev failed while loading ${resource}.`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonWithLimit(response: Response, resource: Resource): Promise<unknown> {
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
        throw new TarkovUpstreamError(
          `Tarkov.dev returned an oversized ${resource} payload.`
        );
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join("")) as unknown;
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
      return isRecord(data) && optionalDictionary(data.tasks, isRawTask);
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
    )
  );
}

function isRawTaskObjective(value: unknown): value is RawTaskObjective {
  if (!isRecord(value)) return false;
  return (
    [value.description, value.type, value.item, value.markerItem].every(optionalShortString) &&
    optionalFiniteNumber(value.count) &&
    optionalBoolean(value.foundInRaid) &&
    optionalBoolean(value.optional) &&
    optionalStringArray(value.items) &&
    [
      value.containsAll,
      value.containsOne,
      value.wearing,
      value.usingWeapon,
      value.usingWeaponMods,
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
      [entry.id, entry.description].every(optionalShortString) &&
      optional(entry.position, isPosition)
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
      optionalShortString(entry.name) &&
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
  };
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

export function clearTarkovResourceCache() {
  resourceCache.clear();
  memoCache.clear();
}

export async function listItemSlugs(gameMode: GameMode = "regular") {
  const context = await loadItems(gameMode);
  return memo(`${gameMode}/slugs`, [context], () =>
    Array.from(context.bySlug.keys()).filter((slug) => /^[a-z0-9][a-z0-9-]*$/.test(slug))
  );
}

export async function warmTarkovCache(gameModes: GameMode[] = ["regular", "pve"]) {
  await Promise.allSettled(gameModes.map((gameMode) => getItemCatalog(gameMode)));
}
