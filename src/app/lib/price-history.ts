import { useEffect, useSyncExternalStore } from "react";
import { createStore, getMany, setMany } from "idb-keyval";
import type { GameMode } from "@/components/game-mode/mode";

export interface PricePoint {
  t: number;
  p: number;
}

const MAX_POINTS = 120;
const MIN_INTERVAL_MS = 60 * 60_000;
const VISIT_GAP_MS = 60 * 60_000;
const EMPTY: readonly PricePoint[] = [];

let store: ReturnType<typeof createStore> | null = null;
const histories = new Map<string, readonly PricePoint[]>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function idb() {
  store ??= createStore("eft-price-history", "points");
  return store;
}

function key(gameMode: GameMode, name: string) {
  return `${gameMode}:${name}`;
}

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function isPoints(value: unknown): value is PricePoint[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_POINTS &&
    value.every(
      (point) =>
        point &&
        typeof point === "object" &&
        Number.isFinite((point as PricePoint).t) &&
        Number.isFinite((point as PricePoint).p)
    )
  );
}

export function appendPoint(points: readonly PricePoint[], price: number, now: number): readonly PricePoint[] {
  const last = points.at(-1);
  if (last && now - last.t < MIN_INTERVAL_MS) {
    return last.p === price ? points : [...points.slice(0, -1), { t: last.t, p: price }];
  }
  return [...points, { t: now, p: price }].slice(-MAX_POINTS);
}

export function changeSinceLastVisit(points: readonly PricePoint[], price: number, now: number) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (now - point.t >= VISIT_GAP_MS && point.p > 0) {
      return { since: point.t, previous: point.p, ratio: (price - point.p) / point.p };
    }
  }
  return null;
}

async function load(gameMode: GameMode, names: readonly string[]) {
  const missing = names.filter((name) => !histories.has(key(gameMode, name)) && !loading.has(key(gameMode, name)));
  if (missing.length === 0) return;
  for (const name of missing) loading.add(key(gameMode, name));
  try {
    const values = await getMany(missing.map((name) => key(gameMode, name)), idb());
    missing.forEach((name, index) => {
      const value = values[index];
      histories.set(key(gameMode, name), isPoints(value) ? value : EMPTY);
    });
  } catch {
    for (const name of missing) histories.set(key(gameMode, name), EMPTY);
  } finally {
    for (const name of missing) loading.delete(key(gameMode, name));
    notify();
  }
}

export async function recordPrices(gameMode: GameMode, entries: readonly { name: string; price: number }[]) {
  const valid = entries.filter((entry) => entry.name && Number.isFinite(entry.price) && entry.price > 0);
  if (valid.length === 0) return;
  await load(gameMode, valid.map((entry) => entry.name));
  const now = Date.now();
  const updates: [string, readonly PricePoint[]][] = [];
  for (const { name, price } of valid) {
    const id = key(gameMode, name);
    const current = histories.get(id) ?? EMPTY;
    const next = appendPoint(current, price, now);
    if (next !== current) updates.push([id, next]);
  }
  if (updates.length === 0) return;
  try {
    await setMany(updates as [string, PricePoint[]][], idb());
  } catch {
    return;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePriceHistories(gameMode: GameMode, names: readonly string[], enabled = true) {
  const joined = names.join("\u0000");
  useEffect(() => {
    if (enabled && joined) void load(gameMode, joined.split("\u0000"));
  }, [enabled, gameMode, joined]);
  useSyncExternalStore(subscribe, () => version, () => 0);
  return (name: string) => histories.get(key(gameMode, name)) ?? EMPTY;
}
