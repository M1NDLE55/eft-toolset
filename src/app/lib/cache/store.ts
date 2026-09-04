import {
  clear,
  createStore,
  del,
  delMany,
  get,
  getMany,
  keys,
  set,
  setMany,
} from "idb-keyval";

const store = createStore("eft-cache", "bulk-data");

export function cacheGet<T>(key: string): Promise<T | undefined> {
  return get<T>(key, store);
}

export function cacheSet<T>(key: string, value: T): Promise<void> {
  return set(key, value, store);
}

export function cacheGetMany<T>(keys: string[]): Promise<(T | undefined)[]> {
  return getMany<T>(keys, store);
}

export function cacheSetMany<T>(entries: [string, T][]): Promise<void> {
  return setMany(entries, store);
}

export function cacheDelete(key: string): Promise<void> {
  return del(key, store);
}

export function cacheDeleteMany(keysToDelete: string[]): Promise<void> {
  return delMany(keysToDelete, store);
}

export function cacheKeys(): Promise<IDBValidKey[]> {
  return keys(store);
}

export function cacheClear(): Promise<void> {
  return clear(store);
}
