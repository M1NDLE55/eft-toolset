// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { OptimizerBusyError, releaseOptimizerSlot, tryAcquireOptimizerSlot, waitForOptimizerSlot } from "@/app/lib/builds/optimizer-slots";

const open = () => new AbortController().signal;
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe("optimiser slots", () => {
  let held = 0;
  const take = () => {
    held += 1;
  };
  const hold = () => {
    expect(tryAcquireOptimizerSlot()).toBe(true);
    take();
  };
  const release = () => {
    held -= 1;
    releaseOptimizerSlot();
  };

  afterEach(() => {
    while (held > 0) release();
    // Nothing is left over for the next test.
    expect(tryAcquireOptimizerSlot()).toBe(true);
    expect(tryAcquireOptimizerSlot()).toBe(true);
    expect(tryAcquireOptimizerSlot()).toBe(false);
    releaseOptimizerSlot();
    releaseOptimizerSlot();
  });

  it("queues page renders past the cap instead of failing them, oldest first", async () => {
    const order: string[] = [];
    const renders = ["a", "b", "c", "d"].map((name) => waitForOptimizerSlot(open()).then(() => void order.push(name)).then(take));
    await settle();
    expect(order).toEqual(["a", "b"]);

    release();
    await settle();
    expect(order).toEqual(["a", "b", "c"]);

    release();
    await Promise.all(renders);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("is busy at once when too many renders are already waiting, so they can't hold every render slot", async () => {
    hold();
    hold();
    expect(tryAcquireOptimizerSlot()).toBe(false);
    const deadline = new AbortController();
    const queued = Array.from({ length: 4 }, () => waitForOptimizerSlot(deadline.signal));
    await expect(waitForOptimizerSlot(open())).rejects.toBeInstanceOf(OptimizerBusyError);
    deadline.abort();
    for (const waiter of queued) await expect(waiter).rejects.toBeInstanceOf(OptimizerBusyError);
  });

  it("gives up as busy when no slot frees up in time, and leaves nothing behind", async () => {
    hold();
    hold();
    const deadline = new AbortController();
    const waiting = waitForOptimizerSlot(deadline.signal);
    deadline.abort();
    await expect(waiting).rejects.toBeInstanceOf(OptimizerBusyError);
    // The abandoned render is out of the queue: a freed slot goes back to the pool.
    release();
    hold();
  });

  it("doesn't lose a slot to a waiter that's woken but never comes back for it", async () => {
    hold();
    hold();
    // A render whose request is about to go: queued, and slow to come back for the slot when woken.
    const deadline = new AbortController();
    const gone = waitForOptimizerSlot(deadline.signal);
    await settle();
    release();
    // The slot is free for whoever asks next, rather than handed to the render and held.
    hold();
    deadline.abort();
    await expect(gone).rejects.toBeInstanceOf(OptimizerBusyError);
  });
});
