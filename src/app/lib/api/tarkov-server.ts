import type { GameMode } from "@/components/game-mode/context";
import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedItem,
  CachedTask,
  CatalogItem,
  ComposedItem,
} from "@/app/lib/cache/types";
import type {
  BuildItemData,
  GunListItem,
  ModSlotDef,
  PickItemData,
  PresetContents,
} from "@/app/lib/types/gunBuilder";
import type {
  ExtractFaction,
  MapDetails,
  MapSpawn,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import { TARKOV_OPERATIONS, type TarkovOperation } from "./operations";

const UPSTREAM_BASE_URL = "https://json.tarkov.dev";
const UPSTREAM_TIMEOUT_MS = 45_000;
const UPSTREAM_MAX_BYTES = 32 * 1024 * 1024;
const RESOURCE_TTL_MS = 5 * 60_000;
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
}

interface RawTraderOffer {
  trader?: string;
  priceRUB?: number | null;
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
  presets?: string[] | null;
  slots?: RawSlot[] | null;
  baseItem?: string | null;
}

interface RawItem {
  id?: string;
  normalizedName?: string;
  name?: string;
  shortName?: string | null;
  gridImageLink?: string | null;
  wikiLink?: string | null;
  fleaMarketFee?: number | null;
  width?: number | null;
  height?: number | null;
  weight?: number | null;
  basePrice?: number | null;
  lastLowPrice?: number | null;
  avg24hPrice?: number | null;
  changeLast48hPercent?: number | null;
  types?: string[] | null;
  buyFromTrader?: RawTraderOffer[] | null;
  sellToTrader?: RawTraderOffer[] | null;
  conflictingItems?: string[] | null;
  conflictingSlotIds?: string[] | null;
  properties?: RawItemProperties | null;
  containsItems?: RawContainedItem[] | null;
}

interface RawTaskObjective {
  description?: string | null;
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
  objectives?: RawTaskObjective[] | null;
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
}

interface ItemsData {
  items?: Dictionary<RawItem>;
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
}

interface ResourceCacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
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

const resourceCache = new Map<string, ResourceCacheEntry>();

export async function executeTarkovOperation(
  operation: TarkovOperation,
  variables: unknown
): Promise<unknown> {
  const input = asRecord(variables);
  const gameMode = readGameMode(input);

  switch (operation) {
    case TARKOV_OPERATIONS.itemCatalog:
      return getItemCatalog(gameMode);
    case TARKOV_OPERATIONS.groupItems:
      return getGroupItems(gameMode, readStringList(input.names, "names", MAX_NAMES));
    case TARKOV_OPERATIONS.itemDetail:
      return getItemDetail(gameMode, readString(input.name, "name", 500));
    case TARKOV_OPERATIONS.gunList:
      return getGunList(gameMode);
    case TARKOV_OPERATIONS.buildItems:
      return getBuildItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
    case TARKOV_OPERATIONS.pickItems:
      return getPickItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
    case TARKOV_OPERATIONS.preset:
      return getPreset(gameMode, readString(input.id, "id", 80));
    case TARKOV_OPERATIONS.mapDetails:
      return getMapDetails(gameMode, readString(input.mapKey, "mapKey", 80));
  }
}

async function getItemCatalog(gameMode: GameMode): Promise<CatalogItem[]> {
  const { items, translations } = await loadItems(gameMode);
  return projectItemCatalog(items, translations);
}

async function getGroupItems(gameMode: GameMode, names: string[]): Promise<CachedItem[]> {
  if (names.length === 0) return [];
  const [itemContext, traderNames, taskContext] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
    loadTasks(gameMode),
  ]);
  const { items, translations, fleaMarket } = itemContext;
  const requested = new Set(names);
  const tasksByItem = indexTasksByItem(taskContext.tasks);
  return items.flatMap((item) => {
    const name = translate(item.name, translations);
    if (!requested.has(name)) return [];
    const usedInTasks = (tasksByItem.get(item.id ?? "") ?? []).map((task) => ({
      name: translate(task.name, taskContext.translations),
    }));
    return [
      projectCachedItem(item, name, translations, traderNames, usedInTasks, fleaMarket),
    ];
  });
}

async function getItemDetail(
  gameMode: GameMode,
  requestedName: string
): Promise<ComposedItem | null> {
  const [itemContext, traderNames, taskContext, barters, crafts, stations] =
    await Promise.all([
      loadItems(gameMode),
      loadTraderNames(gameMode),
      loadTasks(gameMode),
      loadArrayResource<RawBarter>(gameMode, "barters"),
      loadArrayResource<RawCraft>(gameMode, "crafts"),
      loadStationNames(gameMode),
    ]);

  const item = itemContext.items.find(
    (candidate) => translate(candidate.name, itemContext.translations) === requestedName
  );
  if (!item?.id) return null;

  const itemById = new Map(
    itemContext.items.flatMap((candidate) =>
      candidate.id ? ([[candidate.id, candidate]] as const) : []
    )
  );
  const taskById = new Map(
    taskContext.tasks.flatMap((task) => (task.id ? ([[task.id, task]] as const) : []))
  );
  const tasks = (indexTasksByItem(taskContext.tasks).get(item.id) ?? []).map((task) =>
    projectTask(task, taskContext.translations, traderNames)
  );
  const bartersUsing = barters
    .filter((barter) => containsBarterItem(barter.requiredItems, item.id!))
    .map((barter) =>
      projectBarter(
        barter,
        itemById,
        itemContext.translations,
        traderNames,
        taskById,
        taskContext.translations
      )
    );
  const craftsUsing = crafts
    .filter((craft) => containsItem(craft.requiredItems, item.id!))
    .map((craft) =>
      projectCraft(
        craft,
        itemById,
        itemContext.translations,
        stations,
        taskById,
        taskContext.translations
      )
    );

  return {
    ...projectCachedItem(
      item,
      requestedName,
      itemContext.translations,
      traderNames,
      tasks.map(({ name }) => ({ name })),
      itemContext.fleaMarket
    ),
    usedInTasks: tasks,
    bartersUsing,
    craftsUsing,
  };
}

async function getGunList(gameMode: GameMode): Promise<GunListItem[]> {
  const { items, translations } = await loadItems(gameMode);
  return items
    .filter((item) => item.types?.includes("gun"))
    .map((item) => ({
      id: item.id ?? "",
      name: translate(item.name, translations),
      shortName: translate(item.shortName, translations) || translate(item.name, translations),
      gridImageLink: item.gridImageLink ?? null,
      defaultPresetId: item.properties?.defaultPreset ?? null,
    }))
    .filter((item) => Boolean(item.id));
}

async function getBuildItems(gameMode: GameMode, ids: string[]): Promise<BuildItemData[]> {
  if (ids.length === 0) return [];
  const [{ items, translations }, traderNames] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
  ]);
  const byId = new Map(items.flatMap((item) => (item.id ? ([[item.id, item]] as const) : [])));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [projectBuildItem(item, byId, translations, traderNames)] : [];
  });
}

async function getPickItems(gameMode: GameMode, ids: string[]): Promise<PickItemData[]> {
  if (ids.length === 0) return [];
  const [{ items, translations }, traderNames] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
  ]);
  const byId = new Map(items.flatMap((item) => (item.id ? ([[item.id, item]] as const) : [])));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [projectPickItem(item, translations, traderNames)] : [];
  });
}

async function getPreset(gameMode: GameMode, id: string): Promise<PresetContents | null> {
  const { items } = await loadItems(gameMode);
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return null;
  return {
    baseItemId: item.properties?.baseItem ?? null,
    itemIds: (item.containsItems ?? []).flatMap((entry) =>
      typeof entry.item === "string" ? [entry.item] : []
    ),
  };
}

async function getMapDetails(gameMode: GameMode, mapKey: string): Promise<MapDetails | null> {
  const [mapsEnvelope, translationsEnvelope, { items, translations: itemTranslations }] =
    await Promise.all([
      loadResource<MapsData>(gameMode, "maps"),
      loadResource<TranslationDictionary>(gameMode, "maps_en"),
      loadItems(gameMode),
    ]);
  const raw = Object.values(mapsEnvelope.data.maps ?? {}).find(
    (map) => map.normalizedName === mapKey
  );
  if (!raw) return null;
  const itemNames = new Map(
    items.flatMap((item) =>
      item.id
        ? ([[item.id, translate(item.name, itemTranslations)]] as const)
        : []
    )
  );
  return projectMap(
    mapKey,
    raw,
    translationsEnvelope.data,
    mapsEnvelope.data.lootContainers ?? {},
    mapsEnvelope.data.stationaryWeapons ?? {},
    itemNames
  );
}

async function loadItems(gameMode: GameMode) {
  const [itemsEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<ItemsData>(gameMode, "items"),
    loadResource<TranslationDictionary>(gameMode, "items_en"),
  ]);
  return {
    items: Object.values(itemsEnvelope.data.items ?? {}),
    translations: translationsEnvelope.data,
    fleaMarket: itemsEnvelope.data.fleaMarket,
  };
}

async function loadTasks(gameMode: GameMode) {
  const [tasksEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<TasksData>(gameMode, "tasks"),
    loadResource<TranslationDictionary>(gameMode, "tasks_en"),
  ]);
  return {
    tasks: Object.values(tasksEnvelope.data.tasks ?? {}),
    translations: translationsEnvelope.data,
  };
}

async function loadTraderNames(gameMode: GameMode) {
  const [tradersEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<Dictionary<RawNamedEntity>>(gameMode, "traders"),
    loadResource<TranslationDictionary>(gameMode, "traders_en"),
  ]);
  return new Map(
    Object.entries(tradersEnvelope.data).map(([id, trader]) => [
      id,
      translate(trader.name, translationsEnvelope.data) || trader.normalizedName || id,
    ])
  );
}

async function loadStationNames(gameMode: GameMode) {
  const [stationsEnvelope, translationsEnvelope] = await Promise.all([
    loadResource<Dictionary<RawNamedEntity>>(gameMode, "hideout"),
    loadResource<TranslationDictionary>(gameMode, "hideout_en"),
  ]);
  return new Map(
    Object.entries(stationsEnvelope.data).map(([id, station]) => [
      id,
      translate(station.name, translationsEnvelope.data) || station.normalizedName || id,
    ])
  );
}

async function loadArrayResource<T>(gameMode: GameMode, resource: "barters" | "crafts") {
  const envelope = await loadResource<T[]>(gameMode, resource);
  return Array.isArray(envelope.data) ? envelope.data : [];
}

async function loadResource<T>(gameMode: GameMode, resource: Resource) {
  const cacheKey = `${gameMode}/${resource}`;
  const cached = resourceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as Promise<UpstreamEnvelope<T>>;
  }

  const value = fetchResource<T>(gameMode, resource);
  resourceCache.set(cacheKey, {
    expiresAt: Date.now() + RESOURCE_TTL_MS,
    value,
  });
  value.catch(() => resourceCache.delete(cacheKey));
  return value;
}

async function fetchResource<T>(gameMode: GameMode, resource: Resource) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPSTREAM_BASE_URL}/${gameMode}/${resource}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: RESOURCE_TTL_MS / 1000 },
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
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object" || !("data" in body)) {
      throw new TarkovUpstreamError(`Tarkov.dev returned invalid ${resource} data.`);
    }
    return body as UpstreamEnvelope<T>;
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

export function projectItemCatalog(
  items: RawItem[],
  translations: TranslationDictionary
): CatalogItem[] {
  return items.flatMap((item) => {
    if (!item.id || !item.normalizedName) return [];
    return [
      {
        id: item.id,
        normalizedName: item.normalizedName,
        name: translate(item.name, translations),
        shortName: translateNullable(item.shortName, translations),
        gridImageLink: item.gridImageLink ?? null,
      },
    ];
  });
}

function projectCachedItem(
  item: RawItem,
  name: string,
  translations: TranslationDictionary,
  traderNames: Map<string, string>,
  usedInTasks: { name: string }[],
  fleaMarket?: ItemsData["fleaMarket"]
): CachedItem {
  const fleaBuyPrice = finiteNumber(item.avg24hPrice) ?? finiteNumber(item.lastLowPrice);
  const fleaSellPrice = finiteNumber(item.lastLowPrice);
  const canUseFlea = !item.types?.includes("noFlea") && fleaSellPrice !== null;
  const buyFor = projectTraderPrices(item.buyFromTrader, traderNames);
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
    gridImageLink: item.gridImageLink ?? null,
    wikiLink: item.wikiLink ?? null,
    fleaMarketFee:
      finiteNumber(item.fleaMarketFee) ?? calculateFleaMarketFee(item, fleaMarket),
    width: finiteNumber(item.width) ?? 1,
    height: finiteNumber(item.height) ?? 1,
    changeLast48hPercent: finiteNumber(item.changeLast48hPercent),
    buyFor,
    sellFor,
    usedInTasks,
  };
}

function projectTraderPrices(
  offers: RawTraderOffer[] | null | undefined,
  traderNames: Map<string, string>
) {
  return (offers ?? []).flatMap((offer) => {
    const priceRUB = finiteNumber(offer.priceRUB);
    if (!offer.trader || priceRUB === null) return [];
    return [{ vendor: { name: traderNames.get(offer.trader) ?? offer.trader }, priceRUB }];
  });
}

function projectTask(
  task: RawTask,
  translations: TranslationDictionary,
  traderNames: Map<string, string>
): CachedTask {
  return {
    name: translate(task.name, translations),
    minPlayerLevel: finiteNumber(task.minPlayerLevel) ?? 0,
    wikiLink: task.wikiLink ?? null,
    trader: { name: (task.trader && traderNames.get(task.trader)) || task.trader || "Unknown" },
    objectives: (task.objectives ?? []).map((objective) => ({
      description: translateNullable(objective.description, translations),
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
    requiredItems: projectContainedItems(craft.requiredItems, itemById, itemTranslations),
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
    wikiLink: task.wikiLink ?? null,
  };
}

function projectContainedItems(
  entries: RawContainedItem[] | null | undefined,
  itemById: Map<string, RawItem>,
  translations: TranslationDictionary
): CachedContainedItem[] {
  return (entries ?? []).flatMap((entry) => {
    if (!entry.item) return [];
    const item = itemById.get(entry.item);
    return [
      {
        item: { name: item ? translate(item.name, translations) : entry.item },
        quantity: finiteNumber(entry.count) ?? 0,
      },
    ];
  });
}

function indexTasksByItem(tasks: RawTask[]) {
  const index = new Map<string, RawTask[]>();
  for (const task of tasks) {
    const itemIds = new Set<string>();
    for (const objective of task.objectives ?? []) {
      collectItemIds(objective.item, itemIds);
      collectItemIds(objective.items, itemIds);
      collectItemIds(objective.markerItem, itemIds);
      collectItemIds(objective.containsOne, itemIds);
      collectItemIds(objective.containsAll, itemIds);
      collectItemIds(objective.wearing, itemIds);
      collectItemIds(objective.usingWeapon, itemIds);
      collectItemIds(objective.usingWeaponMods, itemIds);
    }
    for (const itemId of itemIds) {
      const matches = index.get(itemId) ?? [];
      matches.push(task);
      index.set(itemId, matches);
    }
  }
  return index;
}

function collectItemIds(value: unknown, ids: Set<string>) {
  if (typeof value === "string") {
    ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectItemIds(entry, ids);
    return;
  }
  if (!value || typeof value !== "object") return;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id === "string") ids.add(entry.id);
  if (typeof entry.item === "string") ids.add(entry.item);
}

function containsItem(entries: RawContainedItem[] | null | undefined, id: string) {
  return (entries ?? []).some((entry) => entry.item === id);
}

function containsBarterItem(entries: RawContainedItem[] | null | undefined, id: string) {
  return (entries ?? []).some((entry) => equivalentBarterItem(entry.item, id));
}

const DOGTAG_IDS = new Set([
  "59f32bb586f774757e1e8442",
  "59f32c3b86f77472a31742f0",
  "5b9b9020e7ef6f5716480215",
]);
const BOTH_DOGTAGS_ID = "5b9b9020e7ef6f5716480215";

function equivalentBarterItem(entryId: string | undefined, requestedId: string) {
  if (!entryId) return false;
  return (
    entryId === requestedId ||
    (entryId === BOTH_DOGTAGS_ID && DOGTAG_IDS.has(requestedId)) ||
    (requestedId === BOTH_DOGTAGS_ID && DOGTAG_IDS.has(entryId))
  );
}

function projectBuildItem(
  item: RawItem,
  itemById: Map<string, RawItem>,
  translations: TranslationDictionary,
  traderNames: Map<string, string>
): BuildItemData {
  const properties = item.properties;
  const isWeapon = properties?.propertiesType === "ItemPropertiesWeapon";
  return {
    id: item.id ?? "",
    name: translate(item.name, translations),
    shortName: translate(item.shortName, translations) || translate(item.name, translations),
    gridImageLink: item.gridImageLink ?? null,
    weight: finiteNumber(item.weight) ?? 0,
    traderPriceRUB: cheapestTraderPrice(item.buyFromTrader, traderNames),
    fleaPriceRUB: finiteNumber(item.avg24hPrice) ?? finiteNumber(item.lastLowPrice),
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
  };
}

function projectPickItem(
  item: RawItem,
  translations: TranslationDictionary,
  traderNames: Map<string, string>
): PickItemData {
  return {
    id: item.id ?? "",
    name: translate(item.name, translations),
    shortName: translate(item.shortName, translations) || translate(item.name, translations),
    gridImageLink: item.gridImageLink ?? null,
    weight: finiteNumber(item.weight) ?? 0,
    traderPriceRUB: cheapestTraderPrice(item.buyFromTrader, traderNames),
    fleaPriceRUB: finiteNumber(item.avg24hPrice) ?? finiteNumber(item.lastLowPrice),
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

function cheapestTraderPrice(
  offers: RawTraderOffer[] | null | undefined,
  traderNames: Map<string, string>
) {
  const prices = projectTraderPrices(offers, traderNames).map((offer) => offer.priceRUB);
  return prices.length > 0 ? Math.min(...prices) : null;
}

const EXTRACT_FACTIONS: ExtractFaction[] = ["pmc", "scav", "shared"];

function projectMap(
  key: string,
  raw: RawMap,
  translations: TranslationDictionary,
  lootContainerById: Dictionary<RawNamedEntity>,
  stationaryWeaponById: Dictionary<RawNamedEntity>,
  itemNames: Map<string, string>
): MapDetails {
  const spawns: MapSpawn[] = [];
  for (const spawn of raw.spawns ?? []) {
    if (!spawn.position) continue;
    const kind = spawnKind(spawn.sides, spawn.categories);
    if (!kind) continue;
    spawns.push({
      zoneName: spawn.zoneName ?? null,
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
  };
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

function calculateFleaMarketFee(
  item: RawItem,
  fleaMarket: ItemsData["fleaMarket"]
): number | null {
  if (item.types?.includes("noFlea")) return null;
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
}
