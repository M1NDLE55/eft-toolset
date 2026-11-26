// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { regionalCache } from "@/app/lib/api/shared-cache";
import { setPlatform, type SharedStore } from "@/app/lib/server/platform";

afterEach(() => {
  setPlatform();
  vi.useRealTimers();
});

function store(overrides: Partial<SharedStore> = {}): SharedStore {
  const values = new Map<string, string>([["key", '{"a":1}']]);
  return {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => void values.set(key, value),
    ...overrides,
  };
}

it("reads JSON values from the platform's shared store (KV in the Worker)", async () => {
  setPlatform({ sharedStore: store() });
  await expect(regionalCache().get("key")).resolves.toEqual({ a: 1 });
  await expect(regionalCache().get("other")).resolves.toBeNull();
});

it("treats failures, slow reads and bad JSON as misses", async () => {
  setPlatform({ sharedStore: store({ get: async () => Promise.reject(new Error("down")) }) });
  await expect(regionalCache().get("key")).resolves.toBeNull();

  setPlatform({ sharedStore: store({ get: async () => "{not json" }) });
  await expect(regionalCache().get("key")).resolves.toBeNull();

  vi.useFakeTimers();
  setPlatform({ sharedStore: store({ get: () => new Promise<string>(() => undefined) }) });
  const slow = regionalCache().get("key");
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(slow).resolves.toBeNull();
});

it("shares nothing without a shared store", async () => {
  await expect(regionalCache().get("key")).resolves.toBeNull();
});
