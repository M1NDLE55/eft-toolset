import {
  cacheDelete,
  cacheDeleteMany,
  cacheGet,
  cacheGetMany,
  cacheKeys,
  cacheSet,
} from "@/app/lib/cache/store";

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
  expiresAt?: number;
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
const generations = new Map<string, number>();
let lastPersistenceSweepAt = 0;
let persistenceSweep: Promise<void> | null = null;
const PERSISTENCE_SWEEP_INTERVAL_MS = 60 * 60_000;
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
      if (active && inFlight.get(key) === active) inFlight.delete(key);
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
  const requestedGeneration = generations.get(key) ?? 0;
  await hydrate(definition, key);
  if ((generations.get(key) ?? 0) !== requestedGeneration) {
    throw new DOMException("Query invalidated", "AbortError");
  }

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
  generations.set(key, (generations.get(key) ?? 0) + 1);
  const active = inFlight.get(key);
  if (active) {
    inFlight.delete(key);
    active.controller.abort(new DOMException("Query invalidated", "AbortError"));
  }
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
  startPersistenceSweep();
  const existing = hydration.get(key);
  if (existing) return existing;

  const generation = generations.get(key) ?? 0;
  const task = (async () => {
    try {
      const entry = await cacheGet<CacheEnvelope<unknown>>(persistenceKey(key));
      if (
        !entry ||
        entry.version !== definition.version ||
        (entry.expiresAt !== undefined
          ? entry.expiresAt < Date.now()
          : Date.now() - entry.updatedAt > definition.maxAge) ||
        (definition.validate && !definition.validate(entry.data))
      ) {
        if (entry) await cacheDelete(persistenceKey(key));
        return;
      }
      if ((generations.get(key) ?? 0) === generation) memory.set(key, entry);
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
  const generation = generations.get(key) ?? 0;
  publish(key, {
    data: previous?.data,
    error: undefined,
    status: previous ? "success" : "loading",
    isFetching: true,
    updatedAt: previous?.updatedAt,
    stale: Boolean(previous),
  });

  const controller = new AbortController();
  let promise: Promise<Data>;
  promise = definition
    .fetch(variables, controller.signal)
    .then((data) => {
      if (controller.signal.aborted || (generations.get(key) ?? 0) !== generation) {
        throw controller.signal.reason ?? new DOMException("Stale query result", "AbortError");
      }
      if (definition.validate && !definition.validate(data)) {
        throw new Error(`Query ${definition.id} returned an invalid response.`);
      }

      const entry: CacheEnvelope<Data> = {
        version: definition.version,
        updatedAt: Date.now(),
        expiresAt: Date.now() + definition.maxAge,
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
      const normalized = normalizeQueryError(error);
      if (
        normalized.name !== "AbortError" &&
        (generations.get(key) ?? 0) === generation
      ) {
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
    .finally(() => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    });

  inFlight.set(key, { controller, promise });
  return promise;
}

function publish<Data>(key: string, snapshot: QuerySnapshot<Data>) {
  snapshots.set(key, snapshot);
  if (snapshots.size > 500) {
    for (const candidate of snapshots.keys()) {
      if (listeners.has(candidate) || inFlight.has(candidate)) continue;
      snapshots.delete(candidate);
      if (snapshots.size <= 500) break;
    }
  }
  notify(key);
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function persistenceKey(key: string) {
  return `query:${hashKey(key)}:${key.length}`;
}

function normalizeQueryError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "name" in error) {
    const normalized = new Error(
      "message" in error && typeof error.message === "string" ? error.message : "Query failed."
    );
    normalized.name = typeof error.name === "string" ? error.name : "Error";
    return normalized;
  }
  return new Error("Query failed.");
}

function startPersistenceSweep() {
  const now = Date.now();
  if (persistenceSweep || now - lastPersistenceSweepAt < PERSISTENCE_SWEEP_INTERVAL_MS) return;
  lastPersistenceSweepAt = now;
  persistenceSweep = (async () => {
    try {
      const allKeys = (await cacheKeys()).filter(
        (key): key is string => typeof key === "string" && key.startsWith("query:")
      );
      const values = await cacheGetMany<CacheEnvelope<unknown>>(allKeys);
      const now = Date.now();
      const obsolete = allKeys.filter((key, index) => {
        const value = values[index];
        const currentKeyFormat = /^query:[a-z0-9]+:\d+$/.test(key);
        return (
          !currentKeyFormat ||
          !value ||
          typeof value.updatedAt !== "number" ||
          (value.expiresAt !== undefined && value.expiresAt < now) ||
          now - value.updatedAt > 31 * 24 * 60 * 60_000
        );
      });
      if (obsolete.length > 0) await cacheDeleteMany(obsolete);
    } catch {
      // Persistence cleanup is best-effort; IndexedDB may be unavailable.
    }
  })().finally(() => {
    persistenceSweep = null;
  });
}

function hashKey(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
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
