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
import { AsyncLocalStorage } from "node:async_hooks";

const UPSTREAM_BASE_URL = "https://json.tarkov.dev";
const UPSTREAM_TIMEOUT_MS = 20_000;
const UPSTREAM_MAX_BYTES = 32 * 1024 * 1024;
const RESOURCE_TTL_MS = 5 * 60_000;
const RESOURCE_STALE_MS = 15 * 60_000;
const MAX_RESOURCE_RECORDS = 100_000;
const MAX_NESTED_ENTRIES = 20_000;
const MAX_STRING_LENGTH = 10_000;
const MAX_OBJECTIVE_NODES = 10_000;
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
  staleUntil: number;
  value?: UpstreamEnvelope<unknown>;
  inFlight?: Promise<UpstreamEnvelope<unknown>>;
  lastStaleAt?: number;
}

interface ItemsContext {
  items: RawItem[];
  byId: Map<string, RawItem>;
  byName: Map<string, RawItem>;
  nameById: Map<string, string>;
  translations: TranslationDictionary;
  fleaMarket?: ItemsData["fleaMarket"];
}

interface TasksContext {
  tasks: RawTask[];
  byId: Map<string, RawTask>;
  byItem: Map<string, RawTask[]>;
  translations: TranslationDictionary;
}

interface RelationsContext {
  bartersByItem: Map<string, RawBarter[]>;
  craftsByItem: Map<string, RawCraft[]>;
}

interface DerivedCacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
  stale?: boolean;
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
const derivedCache = new Map<string, DerivedCacheEntry>();
const operationContext = new AsyncLocalStorage<{
  startedAt: number;
  resources: Set<ResourceCacheEntry>;
  stale: boolean;
  signal?: AbortSignal;
}>();

export async function executeTarkovOperation(
  operation: TarkovOperation,
  variables: unknown,
  options: { signal?: AbortSignal; onStale?: () => void } = {}
): Promise<unknown> {
  return operationContext.run(
    { startedAt: Date.now(), resources: new Set(), stale: false, signal: options.signal },
    async () => {
      const input = asRecord(variables);
      const gameMode = readGameMode(input);
      let result: Promise<unknown>;
      switch (operation) {
    case TARKOV_OPERATIONS.itemCatalog:
      result = getItemCatalog(gameMode);
      break;
    case TARKOV_OPERATIONS.groupItems:
      result = getGroupItems(gameMode, readStringList(input.names, "names", MAX_NAMES));
      break;
    case TARKOV_OPERATIONS.itemDetail:
      result = getItemDetail(gameMode, readString(input.name, "name", 500));
      break;
    case TARKOV_OPERATIONS.gunList:
      result = getGunList(gameMode);
      break;
    case TARKOV_OPERATIONS.buildItems:
      result = getBuildItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
      break;
    case TARKOV_OPERATIONS.pickItems:
      result = getPickItems(gameMode, readStringList(input.ids, "ids", MAX_IDS));
      break;
    case TARKOV_OPERATIONS.preset:
      result = getPreset(gameMode, readString(input.id, "id", 80));
      break;
    case TARKOV_OPERATIONS.mapDetails:
      result = getMapDetails(gameMode, readString(input.mapKey, "mapKey", 80));
      break;
    default:
      throw new TarkovRequestError("Unknown query operation.", "INVALID_OPERATION");
      }
      const data = await waitForCaller(result, options.signal);
      const context = operationContext.getStore();
      if (
        context &&
        (context.stale ||
          Array.from(context.resources).some(
            (entry) => (entry.lastStaleAt ?? 0) >= context.startedAt
          ))
      ) options.onStale?.();
      return data;
    }
  );
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

async function getItemCatalog(gameMode: GameMode): Promise<CatalogItem[]> {
  return loadDerived(`${gameMode}/catalog-projection`, async () => {
    const { items, translations } = await loadItems(gameMode);
    throwIfRequestAborted();
    return projectItemCatalog(items, translations);
  });
}

async function getGroupItems(gameMode: GameMode, names: string[]): Promise<CachedItem[]> {
  if (names.length === 0) return [];
  const [itemContext, traderNames, taskContext] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
    loadTasks(gameMode),
  ]);
  const { translations, fleaMarket } = itemContext;
  throwIfRequestAborted();
  return names.flatMap((name) => {
    const item = itemContext.byName.get(name);
    if (!item) return [];
    const usedInTasks = (taskContext.byItem.get(item.id ?? "") ?? []).map((task) => ({
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
  const [itemContext, traderNames, taskContext, relations, stations] =
    await Promise.all([
      loadItems(gameMode),
      loadTraderNames(gameMode),
      loadTasks(gameMode),
      loadRelations(gameMode),
      loadStationNames(gameMode),
    ]);
  throwIfRequestAborted();

  const item = itemContext.byName.get(requestedName);
  if (!item?.id) return null;

  const tasks = (taskContext.byItem.get(item.id) ?? []).map((task) =>
    projectTask(task, taskContext.translations, traderNames)
  );
  const bartersUsing = relatedBarters(relations.bartersByItem, item.id)
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
  const craftsUsing = (relations.craftsByItem.get(item.id) ?? [])
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
  return loadDerived(`${gameMode}/gun-list-projection`, async () => {
    const { items, translations } = await loadItems(gameMode);
    throwIfRequestAborted();
    return items
      .filter((item) => item.types?.includes("gun"))
      .map((item) => ({
        id: item.id ?? "",
        name: translate(item.name, translations),
        shortName: translate(item.shortName, translations) || translate(item.name, translations),
        gridImageLink: safeAssetUrl(item.gridImageLink),
        defaultPresetId: item.properties?.defaultPreset ?? null,
      }))
      .filter((item) => Boolean(item.id));
  });
}

async function getBuildItems(gameMode: GameMode, ids: string[]): Promise<BuildItemData[]> {
  if (ids.length === 0) return [];
  const [{ byId, translations }, traderNames] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
  ]);
  throwIfRequestAborted();
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [projectBuildItem(item, byId, translations, traderNames)] : [];
  });
}

async function getPickItems(gameMode: GameMode, ids: string[]): Promise<PickItemData[]> {
  if (ids.length === 0) return [];
  const [{ byId, translations }, traderNames] = await Promise.all([
    loadItems(gameMode),
    loadTraderNames(gameMode),
  ]);
  throwIfRequestAborted();
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [projectPickItem(item, translations, traderNames)] : [];
  });
}

async function getPreset(gameMode: GameMode, id: string): Promise<PresetContents | null> {
  const { byId } = await loadItems(gameMode);
  throwIfRequestAborted();
  const item = byId.get(id);
  if (!item) return null;
  return {
    baseItemId: item.properties?.baseItem ?? null,
    itemIds: (item.containsItems ?? []).flatMap((entry) =>
      typeof entry.item === "string" ? [entry.item] : []
    ),
  };
}

async function getMapDetails(gameMode: GameMode, mapKey: string): Promise<MapDetails | null> {
  const [mapsEnvelope, translationsEnvelope, { nameById }] =
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
    nameById
  );
}

async function loadItems(gameMode: GameMode) {
  return loadDerived<ItemsContext>(`${gameMode}/items-context`, async () => {
    const [itemsEnvelope, translationsEnvelope] = await Promise.all([
      loadResource<ItemsData>(gameMode, "items"),
      loadResource<TranslationDictionary>(gameMode, "items_en"),
    ]);
    const items = Object.values(itemsEnvelope.data.items ?? {});
    const translations = translationsEnvelope.data;
    return {
      items,
      byId: new Map(
        items.flatMap((item) => (item.id ? ([[item.id, item]] as const) : []))
      ),
      byName: new Map(
        items.map((item) => [translate(item.name, translations), item] as const)
      ),
      nameById: new Map(
        items.flatMap((item) =>
          item.id ? ([[item.id, translate(item.name, translations)]] as const) : []
        )
      ),
      translations,
      fleaMarket: itemsEnvelope.data.fleaMarket,
    };
  });
}

async function loadTasks(gameMode: GameMode) {
  return loadDerived<TasksContext>(`${gameMode}/tasks-context`, async () => {
    const [tasksEnvelope, translationsEnvelope] = await Promise.all([
      loadResource<TasksData>(gameMode, "tasks"),
      loadResource<TranslationDictionary>(gameMode, "tasks_en"),
    ]);
    const tasks = Object.values(tasksEnvelope.data.tasks ?? {});
    return {
      tasks,
      byId: new Map(
        tasks.flatMap((task) => (task.id ? ([[task.id, task]] as const) : []))
      ),
      byItem: indexTasksByItem(tasks),
      translations: translationsEnvelope.data,
    };
  });
}

async function loadTraderNames(gameMode: GameMode) {
  return loadDerived<Map<string, string>>(`${gameMode}/trader-names`, async () => {
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
  });
}

async function loadStationNames(gameMode: GameMode) {
  return loadDerived<Map<string, string>>(`${gameMode}/station-names`, async () => {
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
  });
}

async function loadDerived<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = derivedCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const result = await (cached.value as Promise<T>);
    if (cached.stale) {
      const currentContext = operationContext.getStore();
      if (currentContext) currentContext.stale = true;
    }
    return result;
  }
  const loaderContext = operationContext.getStore();
  const value = loader();
  const entry: DerivedCacheEntry = { expiresAt: Number.POSITIVE_INFINITY, value };
  derivedCache.set(key, entry);
  try {
    const result = await value;
    if (derivedCache.get(key) === entry) {
      entry.expiresAt = Date.now() + RESOURCE_TTL_MS;
      entry.stale = Boolean(
        loaderContext &&
          (loaderContext.stale ||
            Array.from(loaderContext.resources).some(
              (resource) => (resource.lastStaleAt ?? 0) >= loaderContext.startedAt
            ))
      );
    }
    if (entry.stale) {
      const currentContext = operationContext.getStore();
      if (currentContext) currentContext.stale = true;
    }
    return result;
  } catch (error) {
    if (derivedCache.get(key) === entry) derivedCache.delete(key);
    throw error;
  }
}

async function loadArrayResource<T>(gameMode: GameMode, resource: "barters" | "crafts") {
  const envelope = await loadResource<T[]>(gameMode, resource);
  return Array.isArray(envelope.data) ? envelope.data : [];
}

async function loadResource<T>(gameMode: GameMode, resource: Resource) {
  const cacheKey = `${gameMode}/${resource}`;
  const cached = resourceCache.get(cacheKey);
  if (cached) operationContext.getStore()?.resources.add(cached);
  const now = Date.now();
  if (cached?.value && cached.expiresAt > now) {
    return cached.value as UpstreamEnvelope<T>;
  }
  if (cached?.inFlight) return cached.inFlight as Promise<UpstreamEnvelope<T>>;

  const entry: ResourceCacheEntry = cached ?? {
    expiresAt: 0,
    staleUntil: 0,
  };
  operationContext.getStore()?.resources.add(entry);
  const staleValue = entry.value;
  const value = fetchResource<T>(gameMode, resource)
    .then((result) => {
      const completedAt = Date.now();
      entry.value = result;
      entry.expiresAt = completedAt + RESOURCE_TTL_MS;
      entry.staleUntil = completedAt + RESOURCE_TTL_MS + RESOURCE_STALE_MS;
      entry.inFlight = undefined;
      return result;
    })
    .catch((error) => {
      entry.inFlight = undefined;
      if (staleValue && Date.now() <= entry.staleUntil) {
        entry.lastStaleAt = Date.now();
        console.warn(`Serving stale Tarkov ${resource} data after refresh failed.`);
        return staleValue as UpstreamEnvelope<T>;
      }
      if (resourceCache.get(cacheKey) === entry) resourceCache.delete(cacheKey);
      throw error;
    });
  entry.inFlight = value as Promise<UpstreamEnvelope<unknown>>;
  resourceCache.set(cacheKey, entry);
  return value;
}

async function loadRelations(gameMode: GameMode): Promise<RelationsContext> {
  return loadDerived(`${gameMode}/relations-context`, async () => {
    const [barters, crafts] = await Promise.all([
      loadArrayResource<RawBarter>(gameMode, "barters"),
      loadArrayResource<RawCraft>(gameMode, "crafts"),
    ]);
    const bartersByItem = new Map<string, RawBarter[]>();
    const craftsByItem = new Map<string, RawCraft[]>();
    for (const barter of barters) indexRelation(bartersByItem, barter.requiredItems, barter);
    for (const craft of crafts) indexRelation(craftsByItem, craft.requiredItems, craft);
    return { bartersByItem, craftsByItem };
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
        optionalDictionary(data.stationaryWeapons, isRawNamedEntity)
      );
    case "barters":
      return boundedArray(data, isRawBarter, MAX_RESOURCE_RECORDS);
    case "crafts":
      return boundedArray(data, isRawCraft, MAX_RESOURCE_RECORDS);
    case "traders":
    case "hideout":
      return dictionary(data, isRawNamedEntity);
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
      value.recoilModifier,
      value.recoilVertical,
      value.recoilHorizontal,
      value.fireRate,
    ].every(optionalFiniteNumber) &&
    optionalStringArray(value.fireModes) &&
    optionalStringArray(value.presets) &&
    optionalArray(value.slots, isRawSlot)
  );
}

function isRawSlot(value: unknown): value is RawSlot {
  if (!isRecord(value)) return false;
  return (
    [value.id, value.name, value.nameId].every(optionalShortString) &&
    optional(value.required, (entry) => typeof entry === "boolean") &&
    optional(value.filters, (filters) =>
      isRecord(filters) && optionalStringArray(filters.allowedItems)
    )
  );
}

function isRawTraderOffer(value: unknown): value is RawTraderOffer {
  return (
    isRecord(value) &&
    optionalShortString(value.trader) &&
    optionalFiniteNumber(value.priceRUB)
  );
}

function isRawContainedItem(value: unknown): value is RawContainedItem {
  return (
    isRecord(value) &&
    optionalShortString(value.item) &&
    optionalFiniteNumber(value.count)
  );
}

function isRawTask(value: unknown): value is RawTask {
  return (
    isRecord(value) &&
    [value.id, value.name, value.normalizedName, value.wikiLink, value.trader].every(
      optionalShortString
    ) &&
    optionalFiniteNumber(value.minPlayerLevel) &&
    optionalArray(value.objectives, isRawTaskObjective)
  );
}

function isRawTaskObjective(value: unknown): value is RawTaskObjective {
  if (!isRecord(value)) return false;
  return (
    [value.description, value.item, value.markerItem].every(optionalShortString) &&
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

function isRawNamedEntity(value: unknown): value is RawNamedEntity {
  return (
    isRecord(value) &&
    [value.id, value.name, value.normalizedName].every(optionalShortString)
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
      optionalFiniteNumber(entry.bottom)
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
      optional(entry.needsPower, (item) => typeof item === "boolean") &&
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
    )
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
): CatalogItem[] {
  return items.flatMap((item) => {
    if (!item.id || !item.normalizedName) return [];
    return [
      {
        id: item.id,
        normalizedName: item.normalizedName,
        name: translate(item.name, translations),
        shortName: translateNullable(item.shortName, translations),
        gridImageLink: safeAssetUrl(item.gridImageLink),
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
    wikiLink: safeHttpsUrl(task.wikiLink),
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
    wikiLink: safeHttpsUrl(task.wikiLink),
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
    gridImageLink: safeAssetUrl(item.gridImageLink),
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
    gridImageLink: safeAssetUrl(item.gridImageLink),
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
  derivedCache.clear();
}
