// The optimiser is CPU-bound, so only a few runs share an instance with the website. The MCP
// tools and the best-build pages draw from the same allowance.
const MAX_CONCURRENT_OPTIMIZERS = 2;
let runningOptimizers = 0;
// Page renders waiting for a slot, oldest first. Each holds a render slot while it waits, so only a
// few may: past that a render is busy at once rather than starve the item pages' renders.
const waiting: Array<() => void> = [];
const MAX_WAITING = 4;

/** How long a page render waits for a slot before giving up: well inside its render deadline. */
const OPTIMIZER_WAIT_MS = 10_000;

export class OptimizerBusyError extends Error {
  constructor() {
    super("The optimiser is busy.");
    this.name = "OptimizerBusyError";
  }
}

/** Takes a slot if one is free. For MCP tools, which answer "busy" rather than wait. */
export function tryAcquireOptimizerSlot() {
  if (runningOptimizers >= MAX_CONCURRENT_OPTIMIZERS) return false;
  runningOptimizers += 1;
  return true;
}

/**
 * Takes a slot, waiting for one if needed: a page render (the best-build and Gunsmith pages) has
 * time to wait, and failing at once would answer a burst of page requests with server errors.
 * Rejects with OptimizerBusyError when too many renders are already waiting, or none frees up before
 * the signal aborts. Release it with `releaseOptimizerSlot`.
 */
export async function waitForOptimizerSlot(signal: AbortSignal = AbortSignal.timeout(OPTIMIZER_WAIT_MS)): Promise<void> {
  if (tryAcquireOptimizerSlot()) return;
  if (waiting.length >= MAX_WAITING) throw new OptimizerBusyError();
  let first = true;
  // A waiter is only woken; it takes the slot itself, so a waiter whose request has gone never holds one.
  while (!tryAcquireOptimizerSlot()) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(wake);
        if (index >= 0) waiting.splice(index, 1);
        reject(new OptimizerBusyError());
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      // Beaten to a freed slot (by an MCP call or a new render): back to the front of the queue.
      if (first) waiting.push(wake);
      else waiting.unshift(wake);
    });
    first = false;
  }
}

/** Frees a slot and wakes the oldest waiting render to take it. */
export function releaseOptimizerSlot() {
  runningOptimizers = Math.max(0, runningOptimizers - 1);
  waiting.shift()?.();
}
