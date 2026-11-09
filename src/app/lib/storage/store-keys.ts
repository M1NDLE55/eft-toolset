// Keep backup format constants independent of client-side stores.
export const STORE_KEYS = {
  itemGroups: "eft-toolset:item-groups",
  gunBuilds: "eft-toolset:gun-builds",
  raidPlans: "eft-toolset:raid-plans",
} as const;

export const BACKUP_FORMAT = "eft-toolset/backup";
export const BACKUP_VERSION = 1;

/** The /data hash parameter holding a backup to import, encoded like a share link. */
export const BACKUP_IMPORT_PARAM = "import";
