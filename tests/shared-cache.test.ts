// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

const runtimeCache = { get: vi.fn(), set: vi.fn() };
vi.mock("@vercel/functions", () => ({ getCache: () => runtimeCache }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return (await import("@/app/lib/api/shared-cache")).regionalCache();
}

it("uses Vercel's Runtime Cache on Vercel, treating failures as misses", async () => {
  vi.stubEnv("VERCEL", "1");
  const cache = await load();
  runtimeCache.get.mockResolvedValueOnce({ a: 1 });
  await expect(cache.get("key")).resolves.toEqual({ a: 1 });
  runtimeCache.get.mockRejectedValueOnce(new Error("timed out"));
  await expect(cache.get("key")).resolves.toBeNull();
  runtimeCache.set.mockRejectedValueOnce(new Error("timed out"));
  await expect(cache.set("key", 1, 60)).resolves.toBeUndefined();
  expect(runtimeCache.set).toHaveBeenLastCalledWith("key", 1, { ttl: 60 });
});

it("shares nothing off Vercel", async () => {
  vi.stubEnv("VERCEL", "");
  const cache = await load();
  await cache.set("key", 1, 60);
  await expect(cache.get("key")).resolves.toBeNull();
  expect(runtimeCache.set).not.toHaveBeenCalledWith("key", 1, { ttl: 60 });
});
