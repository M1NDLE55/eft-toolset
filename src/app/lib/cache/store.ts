import { createStore, get, set, clear } from "idb-keyval";

const store = createStore("eft-cache", "bulk-data");

export function cacheGet<T>(key: string): Promise<T | undefined> {
  return get<T>(key, store);
}

export function cacheSet<T>(key: string, value: T): Promise<void> {
  return set(key, value, store);
}

export function cacheClear(): Promise<void> {
  return clear(store);
}
