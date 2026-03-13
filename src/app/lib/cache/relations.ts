import type { CachedTask, CachedBarter, CachedCraft } from "./types";

export function getBartersUsingItem(
  itemName: string,
  allBarters: CachedBarter[]
): CachedBarter[] {
  return allBarters.filter((b) =>
    b.requiredItems.some((ri) => ri.item.name === itemName)
  );
}

export function getCraftsUsingItem(
  itemName: string,
  allCrafts: CachedCraft[]
): CachedCraft[] {
  return allCrafts.filter((c) =>
    c.requiredItems.some((ri) => ri.item.name === itemName)
  );
}

export function getUsedInTasks(
  taskNames: string[],
  allTasks: CachedTask[]
): CachedTask[] {
  const nameSet = new Set(taskNames);
  return allTasks.filter((t) => nameSet.has(t.name));
}
