// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { regionalCache } from "@/app/lib/api/shared-cache";
import { setPlatform, type SharedStore } from "@/app/lib/server/platform";

afterEach(() => {
  setPlatform();
  vi.useRealTimers();
});

function store(overrides: Partial<SharedStore> = {}) {
  const values = new Map<string, string>();
  const puts: { key: string; value: string; options?: { expirationTtl?: number } }[] = [];
  const kv: SharedStore = {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value, options) => {
      puts.push({ key, value, options });
      values.set(key, value);
    },
    ...overrides,
  };
  return { kv, puts };
}

it("keeps JSON values in the platform's shared store (KV in the Worker)", async () => {
  const { kv, puts } = store();
  setPlatform({ sharedStore: kv });
  const cache = regionalCache();
  await cache.set("key", { a: 1 }, 600);
  await expect(cache.get("key")).resolves.toEqual({ a: 1 });
  expect(puts).toEqual([{ key: "key", value: '{"a":1}', options: { expirationTtl: 600 } }]);
  expect(cache.maxChars).toBeGreaterThan(9_500_000);
});

it("never asks KV for an expiry shorter than its minimum", async () => {
  const { kv, puts } = store();
  setPlatform({ sharedStore: kv });
  await regionalCache().set("key", 1, 5);
  expect(puts[0].options).toEqual({ expirationTtl: 60 });
});

it("treats failures, slow reads and bad JSON as misses, and drops failed writes", async () => {
  setPlatform({ sharedStore: store({ get: async () => Promise.reject(new Error("down")), put: async () => Promise.reject(new Error("429")) }).kv });
  await expect(regionalCache().get("key")).resolves.toBeNull();
  await expect(regionalCache().set("key", 1, 60)).resolves.toBeUndefined();

  setPlatform({ sharedStore: store({ get: async () => "{not json" }).kv });
  await expect(regionalCache().get("key")).resolves.toBeNull();

  vi.useFakeTimers();
  setPlatform({ sharedStore: store({ get: () => new Promise<string>(() => undefined) }).kv });
  const slow = regionalCache().get("key");
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(slow).resolves.toBeNull();
});

it("shares nothing without a shared store", async () => {
  const cache = regionalCache();
  await cache.set("key", 1, 60);
  await expect(cache.get("key")).resolves.toBeNull();
  expect(cache.maxChars).toBe(0);
});
