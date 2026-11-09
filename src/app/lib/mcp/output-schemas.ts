import { z } from "zod";

// Output schemas name the fields clients can rely on. Objects stay open so later additions
// don't break older clients.
const object = z.looseObject;
const text = z.string();
const maybeText = z.string().nullable();
const num = z.number();
const maybeNum = z.number().nullable();
const bool = z.boolean();
const list = <T extends z.ZodType>(entry: T) => z.array(entry);
const gameMode = z.enum(["regular", "pve"]);
const warnings = list(text).optional();

/** Every result can carry a dataNotice when it was built from cached data. */
function result<Shape extends z.ZodRawShape>(shape: Shape) {
  return object({ ...shape, dataNotice: text.optional().describe("Set when tarkov.dev was unreachable.") });
}

const sale = object({ vendor: text, priceRUB: num, afterFleaFee: bool, perSlotRUB: num }).nullable();
const offer = object({ vendor: text, priceRUB: num });

const stats = object({
  ergonomics: maybeNum,
  recoilVertical: maybeNum,
  recoilHorizontal: maybeNum,
  weightKg: maybeNum,
  costRUB: maybeNum,
  partsWithoutPrice: num,
  partCount: num,
  unknownParts: num,
});

const ammoRow = object({
  id: text,
  name: text,
  shortName: maybeText,
  caliber: maybeText,
  damage: z.union([num, text]),
  totalDamage: num,
  penetration: num,
  armorDamagePercent: num,
  fragmentationPercent: maybeNum,
  speedMps: maybeNum,
  recoilModifierPercent: maybeNum,
  accuracyModifierPercent: maybeNum,
  priceRUB: maybeNum,
  traderPriceRUB: maybeNum,
  trader: maybeText,
  fleaPriceRUB: maybeNum,
});

const verdict = z.enum(["better", "worse", "even"]).nullable();
const slotDiff = object({ slot: text, status: text });

const build = {
  gameMode,
  name: text,
  weapon: object({ id: text, name: text, caliber: maybeText.optional(), url: text.optional() }),
  stats,
  ammo: z.union([
    ammoRow.extend({ fits: bool }),
    object({ loaded: z.null(), compatibleCount: num }),
  ]),
  missingRequiredSlots: list(object({ slot: text, slotPath: list(text), optionCount: num })),
  conflicts: list(object({ kind: text, part: text, with: text })),
  parts: list(
    object({
      slotPath: list(text),
      slot: text,
      itemId: text,
      name: text,
      ergonomics: num,
      recoilModifierPercent: maybeNum,
      priceRUB: maybeNum,
    })
  ),
  shareLink: maybeText,
  shareError: text.optional(),
  ammoId: maybeText,
  warnings,
};

const position = { x: maybeNum, z: maybeNum, y: maybeNum.optional(), level: text };
const named = (extra: z.ZodRawShape = {}) => list(object({ name: maybeText, ...position, ...extra })).optional();

export const searchItemsOutput = result({
  query: text,
  gameMode,
  nextOffset: maybeNum,
  results: list(object({ id: text, name: text, shortName: maybeText, slug: maybeText, url: text })),
});

export const getItemOutput = result({
  gameMode,
  note: text.optional().describe("Set when the item was found by search rather than an exact match."),
  otherMatches: list(text).optional(),
  id: text,
  name: text,
  shortName: maybeText,
  url: text,
  wikiLink: maybeText,
  size: text,
  slots: num,
  bestSell: sale,
  cheapestBuy: offer.nullable(),
  fleaListingFeeRUB: maybeNum,
  change48hPercent: maybeNum,
  buyFrom: list(offer),
  sellTo: list(offer),
  usedInTasks: list(object({ name: text, trader: text, minPlayerLevel: maybeNum, objectives: list(text) })).optional(),
  usedInTaskCount: num.optional(),
  barters: list(object({ trader: text, give: list(text), receive: list(text) })).optional(),
  barterCount: num.optional(),
  crafts: list(object({ station: text, input: list(text), output: list(text) })).optional(),
  craftCount: num.optional(),
});

export const getItemPricesOutput = result({
  gameMode,
  totalRUB: num,
  itemCount: num,
  noBuyer: list(text),
  rows: list(
    object({
      name: text,
      url: text,
      count: num,
      bestSell: sale.optional(),
      totalRUB: maybeNum,
      usedInTasks: list(text),
    })
  ),
  fuzzyMatches: list(object({ input: text, matched: text })).optional(),
  unresolved: list(text).optional(),
  discordText: text.optional(),
});

export const listWeaponsOutput = result({
  gameMode,
  total: num,
  nextOffset: maybeNum,
  weapons: list(object({ id: text, name: text, shortName: maybeText, caliber: maybeText, hasDefaultPreset: bool })),
});

export const getWeaponOutput = result({
  gameMode,
  id: text,
  name: text,
  shortName: maybeText,
  url: text,
  caliber: maybeText,
  fireRate: maybeNum,
  fireModes: list(text),
  defaultAmmo: maybeText,
  baseStats: object({ ergonomics: num, recoilVertical: maybeNum, recoilHorizontal: maybeNum, weightKg: num, priceRUB: maybeNum }),
  presets: list(object({ id: text, name: text })),
  defaultPreset: object({ id: text, name: maybeText, stats }).nullable(),
  slots: list(object({ id: text, nameId: text, name: text, required: bool, optionCount: num })),
  compatibleAmmoCount: num,
});

export const getSlotOptionsOutput = result({
  gameMode,
  slot: object({ id: text, nameId: text, name: text, label: text, required: bool, slotPath: list(text) }),
  current: maybeText,
  total: num,
  nextOffset: maybeNum,
  options: list(
    object({
      id: text,
      name: text,
      ergonomics: num,
      recoilModifierPercent: maybeNum,
      priceRUB: maybeNum,
      conflict: maybeText,
      installed: bool,
    })
  ),
  warnings,
});

export const getAmmoOptionsOutput = result({
  gameMode,
  weapon: maybeText,
  source: z.enum(["weapon", "magazine"]).nullable(),
  magazine: maybeText,
  loaded: maybeText,
  total: num,
  nextOffset: maybeNum,
  ammo: list(ammoRow),
});

export const evaluateBuildOutput = result({
  ...build,
  shoppingList: object({ totalRUB: num, itemCount: num, unpricedCount: num, rows: list(object({ name: text, count: num })) }).optional(),
  discordText: text.optional(),
});

export const modifyBuildOutput = result({ ...build, applied: list(text) });

export const optimizeBuildOutput = result({
  ...build,
  goal: text,
  changed: bool,
  withinBudget: bool,
  notice: text.optional().describe("Set when nothing fits the budget."),
  remainingConflicts: num,
  changes: list(object({ slot: text, status: text, before: maybeText, after: maybeText })),
  statChanges: list(object({ stat: text, before: maybeNum, after: maybeNum, change: maybeNum, verdict })),
});

export const compareBuildsOutput = result({
  gameMode,
  left: object({ name: text, weapon: maybeText, ammo: maybeText }),
  right: object({ name: text, weapon: maybeText, ammo: maybeText }),
  stats: list(
    object({
      stat: text,
      left: maybeNum,
      right: maybeNum,
      difference: maybeNum,
      better: z.enum(["higher", "lower"]),
      rightIs: verdict,
    })
  ),
  slots: list(slotDiff.extend({ left: maybeText, right: maybeText })),
  warnings,
});

export const listMapsOutput = result({ maps: list(object({ key: text, name: text, levels: list(text), url: text })) });

export const getMapDetailsOutput = result({
  gameMode,
  key: text,
  name: text,
  url: text,
  players: maybeText,
  raidDurationMinutes: maybeNum,
  levels: list(text),
  layers: list(object({ group: text, options: list(object({ id: text, label: text, count: num })) })),
  extracts: named({ faction: text }),
  transits: named(),
  spawnZones: list(object({ kind: text, zone: maybeText, points: num, ...position })).optional(),
  spawns: list(object({ kind: text, zone: maybeText, ...position })).optional(),
  locks: list(object({ type: text, key: maybeText, keyUrl: maybeText, needsPower: bool, ...position })).optional(),
  hazards: named(),
  switches: named(),
  stationaryWeapons: named(),
  lootContainerTotal: num.optional(),
  lootContainers: list(object({ type: text, ...position })).optional(),
  nextLootOffset: maybeNum.optional(),
});

export const createRaidPlanOutput = result({
  shareLink: text,
  map: text,
  name: text,
  waypoints: num,
  routeDistanceMeters: num,
  routeDistance: text,
  drawings: num,
  notes: num,
  layers: list(text),
  resolvedPlaces: list(object({ input: text, resolved: text })).optional(),
  warnings,
});

export const readRaidPlanOutput = result({
  name: text,
  map: object({ key: text, name: text }),
  routeDistanceMeters: num,
  routeDistance: text,
  route: list(object({ step: num, x: num, z: num, near: maybeText })),
  drawings: list(object({ kind: text, color: text, points: num, from: maybeText, to: maybeText })),
  notes: list(object({ title: text, body: text, x: num, z: num, near: maybeText })),
  layers: list(text),
});

export const createImportLinkOutput = result({
  importLink: text.describe("Opens /data with the backup ready to review and merge."),
  itemGroups: num,
  builds: num,
  raidPlans: num,
  notes: list(text).describe("Items that were left out or matched by search."),
});
