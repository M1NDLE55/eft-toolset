// The optimiser is CPU-bound, so only a few runs share an instance with the website. The MCP
// tools and the best-build pages draw from the same allowance.
const MAX_CONCURRENT_OPTIMIZERS = 2;
let runningOptimizers = 0;

export function tryAcquireOptimizerSlot() {
  if (runningOptimizers >= MAX_CONCURRENT_OPTIMIZERS) return false;
  runningOptimizers += 1;
  return true;
}

export function releaseOptimizerSlot() {
  runningOptimizers = Math.max(0, runningOptimizers - 1);
}
