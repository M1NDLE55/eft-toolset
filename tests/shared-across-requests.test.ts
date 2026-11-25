// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { platform, setPlatform, sharedAcrossRequests } from "@/app/lib/server/platform";
import { installWorkerPlatform, withExecutionContext } from "@/app/lib/server/worker-platform";

afterEach(() => setPlatform());

function fakeContext() {
  const kept: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void kept.push(promise), passThroughOnException: () => undefined } as unknown as ExecutionContext;
  return { ctx, kept };
}

describe("promises shared between requests", () => {
  it("keeps the request that started one alive until it settles, without a second rejection to handle", async () => {
    const kept: Promise<unknown>[] = [];
    setPlatform({ ...platform(), waitUntil: (promise) => void kept.push(promise) });

    const load = Promise.resolve("items");
    expect(sharedAcrossRequests(load)).toBe(load);
    const failed = Promise.reject(new Error("tarkov.dev answered 502"));
    // The caller still sees the failure; what's kept alive settles quietly.
    await expect(sharedAcrossRequests(failed)).rejects.toThrow("502");
    expect(kept).toHaveLength(2);
    await expect(Promise.all(kept)).resolves.toEqual([undefined, undefined]);
  });

  it("extends the request whose code is running, not whichever started last", async () => {
    installWorkerPlatform({} as Env);
    const first = fakeContext();
    const second = fakeContext();
    let startSecond!: () => void;
    const secondStarted = new Promise<void>((resolve) => (startSecond = resolve));

    const firstRequest = withExecutionContext(first.ctx, async () => {
      // The second request starts while this one is still waiting on its data.
      await secondStarted;
      platform().waitUntil(Promise.resolve("first's refresh"));
    });
    const secondRequest = withExecutionContext(second.ctx, async () => {
      startSecond();
      platform().waitUntil(Promise.resolve("second's write"));
    });
    await Promise.all([firstRequest, secondRequest]);

    expect(first.kept).toHaveLength(1);
    expect(second.kept).toHaveLength(1);
  });

  it("falls back to the latest request for work started outside any handler's async context", async () => {
    installWorkerPlatform({} as Env);
    const latest = fakeContext();
    await withExecutionContext(latest.ctx, async () => undefined);
    platform().waitUntil(Promise.resolve("a callback from the runtime"));
    expect(latest.kept).toHaveLength(1);
  });
});
