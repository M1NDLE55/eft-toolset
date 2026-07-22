import { cacheDelete, cacheGet, cacheSet } from "@/app/lib/cache/store";

export interface QueryDefinition<Variables, Data> {
  id: string;
  version: number;
  staleTime: number;
  maxAge: number;
  persist?: boolean;
  fetch: (variables: Variables, signal: AbortSignal) => Promise<Data>;
  validate?: (value: unknown) => value is Data;
}

export interface QuerySnapshot<Data> {
  data?: Data;
  error?: Error;
  status: "idle" | "loading" | "success" | "error";
  isFetching: boolean;
  updatedAt?: number;
  stale: boolean;
}

interface CacheEnvelope<Data> {
  version: number;
  updatedAt: number;
  data: Data;
}

interface InFlight<Data> {
  controller: AbortController;
  promise: Promise<Data>;
}

const memory = new Map<string, CacheEnvelope<unknown>>();
const snapshots = new Map<string, QuerySnapshot<unknown>>();
const inFlight = new Map<string, InFlight<unknown>>();
const hydration = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();
const IDLE_SNAPSHOT: QuerySnapshot<never> = Object.freeze({
  status: "idle",
  isFetching: false,
  stale: false,
});

export function queryKey<Variables>(definition: QueryDefinition<Variables, unknown>, variables: Variables) {
  return `${definition.id}:${stableSerialize(variables)}`;
}

export function getQuerySnapshot<Data>(key: string): QuerySnapshot<Data> {
  return (snapshots.get(key) as QuerySnapshot<Data> | undefined) ?? IDLE_SNAPSHOT;
}

export function subscribeQuery(key: string, listener: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  return () => {
    const current = listeners.get(key);
    current?.delete(listener);
    if (current?.size === 0) {
      listeners.delete(key);
      const active = inFlight.get(key);
      inFlight.delete(key);
      active?.controller.abort(new DOMException("No active query consumers", "AbortError"));
    }
  };
}

export async function ensureQuery<Variables, Data>(
  definition: QueryDefinition<Variables, Data>,
  variables: Variables,
  options: { force?: boolean } = {}
): Promise<Data> {
  const key = queryKey(definition, variables);
  await hydrate(definition, key);

  const cached = memory.get(key) as CacheEnvelope<Data> | undefined;
  const age = cached ? Date.now() - cached.updatedAt : Infinity;
  if (!options.force && cached && age <= definition.staleTime) {
    publish(key, {
      data: cached.data,
      status: "success",
      isFetching: false,
      updatedAt: cached.updatedAt,
      stale: false,
    });
    return cached.data;
  }

  if (!options.force && cached && age <= definition.maxAge) {
    publish(key, {
      data: cached.data,
      status: "success",
      isFetching: true,
      updatedAt: cached.updatedAt,
      stale: true,
    });
    void revalidate(definition, variables, key).catch(() => undefined);
    return cached.data;
  }

  return revalidate(definition, variables, key);
}

export async function invalidateQuery<Variables, Data>(
  definition: QueryDefinition<Variables, Data>,
  variables: Variables
) {
  const key = queryKey(definition, variables);
  memory.delete(key);
  snapshots.delete(key);
  try {
    await cacheDelete(persistenceKey(key));
  } catch {
    // Persistence is optional.
  }
  notify(key);
}

async function hydrate<Variables, Data>(definition: QueryDefinition<Variables, Data>, key: string) {
  if (!definition.persist || memory.has(key)) return;
  const existing = hydration.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const entry = await cacheGet<CacheEnvelope<unknown>>(persistenceKey(key));
      if (
        !entry ||
        entry.version !== definition.version ||
        Date.now() - entry.updatedAt > definition.maxAge ||
        (definition.validate && !definition.validate(entry.data))
      ) {
        if (entry) await cacheDelete(persistenceKey(key));
        return;
      }
      memory.set(key, entry);
    } catch {
      // IndexedDB can be blocked or unavailable. The network path remains usable.
    }
  })().finally(() => hydration.delete(key));

  hydration.set(key, task);
  return task;
}

async function revalidate<Variables, Data>(
  definition: QueryDefinition<Variables, Data>,
  variables: Variables,
  key: string
): Promise<Data> {
  const existing = inFlight.get(key) as InFlight<Data> | undefined;
  if (existing) return existing.promise;

  const previous = memory.get(key) as CacheEnvelope<Data> | undefined;
  publish(key, {
    data: previous?.data,
    error: undefined,
    status: previous ? "success" : "loading",
    isFetching: true,
    updatedAt: previous?.updatedAt,
    stale: Boolean(previous),
  });

  const controller = new AbortController();
  const promise = definition
    .fetch(variables, controller.signal)
    .then((data) => {
      if (definition.validate && !definition.validate(data)) {
        throw new Error(`Query ${definition.id} returned an invalid response.`);
      }

      const entry: CacheEnvelope<Data> = {
        version: definition.version,
        updatedAt: Date.now(),
        data,
      };
      memory.set(key, entry);
      evictMemoryEntries();
      publish(key, {
        data,
        status: "success",
        isFetching: false,
        updatedAt: entry.updatedAt,
        stale: false,
      });

      if (definition.persist) {
        void cacheSet(persistenceKey(key), entry).catch(() => undefined);
      }
      return data;
    })
    .catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error("Query failed.");
      if (normalized.name !== "AbortError") {
        publish(key, {
          data: previous?.data,
          error: normalized,
          status: previous ? "success" : "error",
          isFetching: false,
          updatedAt: previous?.updatedAt,
          stale: Boolean(previous),
        });
      }
      throw normalized;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, { controller, promise });
  return promise;
}

function publish<Data>(key: string, snapshot: QuerySnapshot<Data>) {
  snapshots.set(key, snapshot);
  notify(key);
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function persistenceKey(key: string) {
  return `query:${key}`;
}

function evictMemoryEntries() {
  const limit = 250;
  if (memory.size <= limit) return;
  const oldest = Array.from(memory.entries())
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
    .slice(0, memory.size - limit);
  for (const [key] of oldest) {
    if (listeners.has(key) || inFlight.has(key)) continue;
    memory.delete(key);
    snapshots.delete(key);
  }
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}
