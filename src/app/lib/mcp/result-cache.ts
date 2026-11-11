import { isSnapshotCurrent, type DataSnapshot } from "@/app/lib/api/tarkov-server";

// Results of the tools that run the optimiser, kept per instance so a repeated call costs no
// optimiser time. A result is reused only while every tarkov.dev dataset it was built from is
// still the copy it used, so it is never older than the data a fresh call would see.
const MAX_ENTRIES = 64;
const MAX_AGE_MS = 30 * 60_000;
/** Calls with longer arguments, such as several long share links, aren't cached. */
const MAX_KEY_CHARS = 16_000;

interface CachedResult {
  payload: Record<string, unknown>;
  snapshot: DataSnapshot;
  storedAt: number;
}

const CACHE_KEY = "__eftToolResults:1";
const shared = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, CachedResult> };
shared[CACHE_KEY] ??= new Map();
const results = shared[CACHE_KEY];

/** The cache key for a call, or undefined when the call is too large to cache. */
export function toolResultKey(tool: string, origin: string, args: unknown): string | undefined {
  const key = JSON.stringify([tool, origin, args]);
  return key.length <= MAX_KEY_CHARS ? key : undefined;
}

export function readToolResult(key: string): Record<string, unknown> | undefined {
  const entry = results.get(key);
  if (!entry) return undefined;
  results.delete(key);
  if (Date.now() - entry.storedAt >= MAX_AGE_MS || !isSnapshotCurrent(entry.snapshot)) return undefined;
  results.set(key, entry);
  return entry.payload;
}

export function storeToolResult(key: string, payload: Record<string, unknown>, snapshot: DataSnapshot) {
  // A result that read no tarkov.dev data can't be checked for staleness.
  if (snapshot.length === 0) return;
  results.delete(key);
  results.set(key, { payload, snapshot, storedAt: Date.now() });
  while (results.size > MAX_ENTRIES) results.delete(results.keys().next().value!);
}

/** Clears every cached result. For tests. */
export function clearToolResults() {
  results.clear();
}
