/**
 * Settings that sync between a user's devices, one row per key (§6.1). Preferences take the newest
 * change; quest progress, which is real work, is kept per quest and asks when two devices disagree.
 */
export const SYNCED_PREFERENCES = [
  "settings:home-layout",
  "settings:item-views",
  "settings:content-scale",
  "gun-builder:price-sources",
  "gun-builder:view",
  "raid-planner:toolbar",
  "raid-planner:layers",
  "scouted-items",
] as const;

const QUEST_PROGRESS = /^quest-progress:[A-Za-z0-9_-]{1,64}$/;

export function isSettingKey(key: unknown): key is string {
  return typeof key === "string" && ((SYNCED_PREFERENCES as readonly string[]).includes(key) || QUEST_PROGRESS.test(key));
}

/** Keys where a clash is reported rather than settled by the newest change. */
export function isConflictingSettingKey(key: string) {
  return QUEST_PROGRESS.test(key);
}
