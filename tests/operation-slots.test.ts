// @vitest-environment node
import { describe, expect, it } from "vitest";
import { releaseOperationSlot, tryAcquireOperationSlot, waitForOperationSlot } from "@/app/lib/api/tarkov-server";

describe("operation slots", () => {
  it("queues page renders for a slot, hands a released slot straight to them, and lets them give up", async () => {
    const held: number[] = [];
    while (tryAcquireOperationSlot()) held.push(1);
    expect(held.length).toBeGreaterThan(0);

    const order: string[] = [];
    const first = waitForOperationSlot(new AbortController().signal).then(() => order.push("first"));
    const gaveUp = new AbortController();
    const second = waitForOperationSlot(gaveUp.signal).then(
      () => order.push("second"),
      () => order.push("second gave up")
    );
    const third = waitForOperationSlot(new AbortController().signal).then(() => order.push("third"));
    gaveUp.abort();
    await second;

    releaseOperationSlot();
    await first;
    // The slot went to the waiting render, so an API request still finds every slot taken.
    expect(tryAcquireOperationSlot()).toBe(false);
    releaseOperationSlot();
    await third;
    expect(order).toEqual(["second gave up", "first", "third"]);

    for (let index = 0; index < held.length; index += 1) releaseOperationSlot();
    expect(tryAcquireOperationSlot()).toBe(true);
    releaseOperationSlot();
  });
});
