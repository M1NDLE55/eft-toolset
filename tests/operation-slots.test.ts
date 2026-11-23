// @vitest-environment node
import { describe, expect, it } from "vitest";
import { releaseOperationSlot, releaseRenderSlot, tryAcquireOperationSlot, waitForRenderSlot } from "@/app/lib/api/tarkov-server";

const open = () => new AbortController().signal;

describe("operation slots", () => {
  it("caps page renders below the total, so API requests always find a slot", async () => {
    const renders: Promise<void>[] = [];
    let granted = 0;
    for (let index = 0; index < 20; index += 1) renders.push(waitForRenderSlot(open()).then(() => void (granted += 1)));
    await Promise.resolve();
    await Promise.resolve();
    expect(granted).toBe(12);
    // Renders hold 12 of 16: the rest go to API and MCP calls.
    const api = [tryAcquireOperationSlot(), tryAcquireOperationSlot(), tryAcquireOperationSlot(), tryAcquireOperationSlot()];
    expect(api).toEqual([true, true, true, true]);
    expect(tryAcquireOperationSlot()).toBe(false);
    // A finished API call doesn't go to a queued render: renders are still at their cap.
    releaseOperationSlot();
    await Promise.resolve();
    expect(granted).toBe(12);
    expect(tryAcquireOperationSlot()).toBe(true);
    // A finished render hands its slot to the next queued one.
    releaseRenderSlot();
    await Promise.resolve();
    await Promise.resolve();
    expect(granted).toBe(13);

    for (let index = 0; index < 4; index += 1) releaseOperationSlot();
    for (let index = 0; index < 20; index += 1) releaseRenderSlot();
    await Promise.all(renders);
    expect(granted).toBe(20);
    for (let index = 0; index < 20; index += 1) releaseRenderSlot();
  });

  it("lets a queued render give up", async () => {
    const held: number[] = [];
    while (tryAcquireOperationSlot()) held.push(1);
    const gaveUp = new AbortController();
    const waiting = waitForRenderSlot(gaveUp.signal);
    gaveUp.abort();
    await expect(waiting).rejects.toBeDefined();
    for (const _ of held) releaseOperationSlot();
    // Nothing was handed to the aborted render.
    expect(tryAcquireOperationSlot()).toBe(true);
    releaseOperationSlot();
  });
});
