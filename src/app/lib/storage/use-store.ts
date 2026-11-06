"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readStore, subscribeStore, type StoreDefinition } from "./versioned-store";

interface Snapshot {
  raw: string | null;
  value: unknown;
}

const snapshots = new Map<string, Snapshot>();
const serverSnapshots = new WeakMap<StoreDefinition<unknown>, unknown>();

function readRaw(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readStoreSnapshot<T>(definition: StoreDefinition<T>): T {
  const raw = readRaw(definition.key);
  const cached = snapshots.get(definition.key);
  if (cached && cached.raw === raw) return cached.value as T;
  const value = readStore(definition);
  snapshots.set(definition.key, { raw: readRaw(definition.key), value });
  return value;
}

function serverSnapshot<T>(definition: StoreDefinition<T>): T {
  const key = definition as StoreDefinition<unknown>;
  if (!serverSnapshots.has(key)) serverSnapshots.set(key, definition.defaultValue());
  return serverSnapshots.get(key) as T;
}

export function useStore<T>(definition: StoreDefinition<T>): T {
  return useSyncExternalStore(
    useCallback((listener) => subscribeStore(definition.key, listener), [definition.key]),
    () => readStoreSnapshot(definition),
    () => serverSnapshot(definition)
  );
}

const noopSubscribe = () => () => undefined;

export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
