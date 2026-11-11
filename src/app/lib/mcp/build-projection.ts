import type {
  AmmoItemData,
  BarterOffer,
  BuildItemData,
  BuildNode,
  PriceSources,
  TaskUnlock,
  TraderOffer,
} from "@/app/lib/types/gunBuilder";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import { findConflicts } from "@/app/lib/builds/conflicts";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import {
  bestOffer,
  effectivePrice,
  levelAllowed,
  offerAllowed,
  offerLabel,
  priceChoice,
  questLocked,
  type PriceChoice,
  type PriceSource,
  type TraderLimits,
} from "@/app/lib/builds/price";
import { pathKey, presetParts, type BuildPurchase } from "@/app/lib/builds/purchase";
import { questChain } from "@/app/lib/builds/quests";
import { checkSights, isMagazineSlot, type SightRole } from "@/app/lib/builds/sights";
import { reconstructPresetTree } from "@/app/lib/builds/presets";
import { itemName, slotLabel, type BuildSource, type ResolvedBuild } from "@/app/lib/builds/resolve";
import { encodeBuildSharePayload, slugifyBuildName } from "@/app/lib/builds/share";
import { computeStats, type BuildStats } from "@/app/lib/builds/stats";
import { childAt } from "@/app/lib/builds/tree";
import { defaultPreset, type BuildPricing, type QuestProgress } from "./build-prices";
import { round, type ToolContext } from "./context";
import { itemUrl } from "./sources";
import { LOOT_ONLY, NO_FLEA_PRICE } from "@/app/lib/item-price";

// How gun-builder results describe builds, parts, and ammo.

async function shareLinkFor(context: ToolContext, build: Omit<ResolvedBuild, "warnings">) {
  const now = Date.now();
  const payload = await encodeBuildSharePayload({
    id: "mcp",
    name: build.name.slice(0, MAX_BUILD_NAME_LENGTH),
    weaponId: build.weaponId,
    root: build.root,
    ...(build.ammoId ? { ammoId: build.ammoId } : {}),
    createdAt: now,
    updatedAt: now,
  });
  return `${context.origin}/gun-builder/share/${slugifyBuildName(build.name)}#b=${payload}`;
}

/** "Caliber556x45NATO" → "556x45NATO", the id other tools and filters accept. */
export function caliberId(caliber: string | null | undefined) {
  return caliber?.replace(/^Caliber/, "") || null;
}

const CALIBER_NAMES: Record<string, string> = {
  "1143x23ACP": ".45 ACP",
  "127x33": ".50 AE",
  "127x99": ".50 BMG",
  "12g": "12 gauge",
  "20g": "20 gauge",
  "366TKM": ".366 TKM",
  "40mmRU": "40mm VOG",
  "46x30": "4.6x30mm",
  "545x39": "5.45x39mm",
  "556x45NATO": "5.56x45mm NATO",
  "57x28": "5.7x28mm",
  "58x42": "5.8x42mm",
  "68x51": "6.8x51mm",
  "762x25TT": "7.62x25mm Tokarev",
  "762x35": ".300 Blackout",
  "762x51": "7.62x51mm NATO",
  "762x54R": "7.62x54mmR",
  "784x49": ".308 ME",
  "86x70": ".338 Lapua Magnum",
  "93x64": "9.3x64mm",
  "9x18PM": "9x18mm Makarov",
  "9x18PMM": "9x18mm PMM",
  "9x19PARA": "9x19mm Parabellum",
  "9x33R": ".357 Magnum",
};

/** "Caliber556x45NATO" → "5.56x45mm NATO"; unlisted ids are read as bore x case length, "762x39" → "7.62x39mm". */
export function formatCaliber(caliber: string | null | undefined) {
  const id = caliberId(caliber);
  if (!id) return null;
  const named = CALIBER_NAMES[id];
  if (named) return named;
  const match = /^(\d+)x(\d+)(.*)$/.exec(id);
  if (!match) return id;
  const [, bore, length, rawSuffix] = match;
  // Three-digit bores carry an implied decimal point: "762" is 7.62mm, "127" is 12.7mm.
  const diameter =
    bore.length === 3 ? (bore.startsWith("1") ? `${bore.slice(0, 2)}.${bore[2]}` : `${bore[0]}.${bore.slice(1)}`) : bore;
  const suffix = rawSuffix.replace(/^mm/, "");
  return `${diameter}x${length}mm${suffix ? ` ${suffix}` : ""}`;
}

interface OfferedItem {
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  barterPriceRUB?: number | null;
  traderName?: string | null;
  traderLevel?: number | null;
  traderOffers?: readonly TraderOffer[];
  barterOffers?: readonly BarterOffer[];
  fleaBanned?: boolean;
}

function blockedOffers(offers: readonly (TraderOffer | BarterOffer)[], limits: TraderLimits | null) {
  const blocked = limits ? offers.filter((offer) => !offerAllowed(offer, limits)) : [];
  if (!blocked.length) return null;
  const reason = (offer: TraderOffer | BarterOffer) =>
    [
      !levelAllowed(offer, limits!) && "above the allowed trader levels",
      limits!.excludeQuestLocked && questLocked(offer, limits) && `after the task ${offer.taskUnlock!.name}, not in completedTasks`,
    ]
      .filter(Boolean)
      .join(" and ");
  const reasons = new Set(blocked.map(reason));
  // One shared reason reads best once, after the offers.
  return reasons.size === 1
    ? { who: blocked.map(offerLabel).join(" or "), why: `, ${[...reasons][0]}` }
    : { who: blocked.map((offer) => `${offerLabel(offer)} (${reason(offer)})`).join(" or "), why: "" };
}

export function priceNote(item: OfferedItem, sources: PriceSources, limits: TraderLimits | null) {
  const offers = item.traderOffers ?? [];
  let trader: string;
  if (!sources.traders) trader = "trader prices are turned off";
  else if (offers.length === 0) trader = "no trader sells it";
  else {
    const blocked = blockedOffers(offers, limits);
    trader = blocked ? `only ${blocked.who} sells it${blocked.why}` : "it has no trader price";
  }
  const flea = item.fleaBanned
    ? NO_FLEA_PRICE.banned
    : !sources.flea
      ? NO_FLEA_PRICE.turnedOff
      : NO_FLEA_PRICE.noPrice;
  const reasons = [trader, flea];
  if (sources.barters) {
    const barters = item.barterOffers ?? [];
    const blocked = blockedOffers(barters, limits);
    reasons.push(
      blocked
        ? `only a barter from ${blocked.who} gives it${blocked.why}`
        : barters.length
          ? "the barters that give it take items the allowed sources and levels don't sell"
          : "no barter gives it"
    );
  }
  const lootOnly = item.fleaBanned && offers.length === 0 && !item.barterOffers?.length ? ` ${LOOT_ONLY}` : "";
  return `Can't be bought: ${reasons.slice(0, -1).join(", ")}, and ${reasons.at(-1)}.${lootOnly}`;
}

function unlockOf(offer: { taskUnlock?: TaskUnlock } | null | undefined) {
  return offer?.taskUnlock ? { taskUnlock: offer.taskUnlock } : {};
}

function projectBarterOffer(barter: BarterOffer) {
  return {
    trader: offerLabel(barter),
    priceRUB: barter.priceRUB,
    give: barter.requiredItems.map((entry) => `${entry.count}× ${entry.name}`),
    ...(barter.count > 1 ? { receive: barter.count } : {}),
    ...unlockOf(barter),
  };
}

function traderOffer(item: OfferedItem, limits: TraderLimits | null) {
  const offer = bestOffer(item.traderOffers, limits);
  if (offer && offer.priceRUB === item.traderPriceRUB) return { label: offerLabel(offer), offer };
  const label = item.traderName ? `${item.traderName}${item.traderLevel ? ` LL${item.traderLevel}` : ""}` : null;
  return { label, offer: null };
}

function offerColumns(item: OfferedItem, sources: PriceSources, limits: TraderLimits | null) {
  const trader = traderOffer(item, limits);
  const barter = sources.barters ? bestOffer(item.barterOffers, limits) : null;
  return {
    traderPriceRUB: item.traderPriceRUB,
    trader: trader.label,
    ...unlockOf(trader.offer),
    fleaPriceRUB: item.fleaPriceRUB,
    ...(barter ? { barter: projectBarterOffer(barter) } : {}),
  };
}

type Purchase = {
  priceRUB: number | null;
  priceNote?: string;
  source?: PriceSource;
  trader?: string | null;
  /** What the barter takes. */
  barter?: string[];
  taskUnlock?: TaskUnlock;
};

function chosenOffer(item: OfferedItem, choice: PriceChoice | null, limits: TraderLimits | null) {
  if (choice?.source === "trader") return choice.offer ?? traderOffer(item, limits).offer;
  return choice?.source === "barter" ? choice.offer : null;
}

function purchase(
  item: OfferedItem,
  sources: PriceSources,
  limits: TraderLimits | null,
  choice = priceChoice(item, sources, limits)
): Purchase {
  if (!choice) return { priceRUB: null, priceNote: priceNote(item, sources, limits) };
  if (choice.source === "flea") return { priceRUB: choice.priceRUB, source: choice.source };
  if (choice.source === "trader") {
    const label = choice.offer ? offerLabel(choice.offer) : traderOffer(item, limits).label;
    return { priceRUB: choice.priceRUB, source: choice.source, trader: label, ...unlockOf(chosenOffer(item, choice, limits)) };
  }
  return {
    priceRUB: choice.priceRUB,
    source: choice.source,
    ...(choice.offer ? { trader: offerLabel(choice.offer), barter: projectBarterOffer(choice.offer).give, ...unlockOf(choice.offer) } : {}),
  };
}

interface Bought {
  name: string;
  item: OfferedItem | undefined;
  /** How it's bought, when not its cheapest price. */
  choice?: PriceChoice | null;
}

function pendingUnlock({ item, choice }: Bought, sources: PriceSources, limits: TraderLimits | null, quests: QuestProgress) {
  if (!item) return null;
  const unlock = chosenOffer(item, choice === undefined ? priceChoice(item, sources, limits) : choice, limits)?.taskUnlock;
  return unlock && !quests.completed.has(unlock.id) ? unlock : null;
}

function requiredTasks(
  items: readonly Bought[],
  sources: PriceSources,
  limits: TraderLimits | null,
  quests: QuestProgress
) {
  const unlocks = new Map<string, string[]>();
  for (const bought of items) {
    const { name } = bought;
    const unlock = pendingUnlock(bought, sources, limits, quests);
    if (!unlock) continue;
    const names = unlocks.get(unlock.id) ?? [];
    if (!names.includes(name)) names.push(name);
    unlocks.set(unlock.id, names);
  }
  return questChain(quests.tasks, unlocks, quests.completed).map(({ task, startOnly, unlocks }) => ({
    id: task.id,
    name: task.name,
    trader: task.trader,
    minPlayerLevel: task.minPlayerLevel,
    ...(task.faction ? { faction: task.faction } : {}),
    ...(task.traderLevels.length
      ? { traderLevels: task.traderLevels.map((entry) => `${entry.trader} LL${entry.level}`) }
      : {}),
    ...(startOnly ? { startOnly: true as const } : {}),
    ...(unlocks.length ? { unlocks } : {}),
  }));
}

function percent(value: number) {
  return round(value * 100, 1);
}

export function projectAmmo(ammo: AmmoItemData, sources: PriceSources, limits: TraderLimits | null = null) {
  const price = effectivePrice(ammo, sources);
  return {
    id: ammo.id,
    name: ammo.name,
    shortName: ammo.shortName,
    caliber: formatCaliber(ammo.caliber),
    caliberId: caliberId(ammo.caliber),
    damage: ammo.projectileCount > 1 ? `${ammo.projectileCount}×${ammo.damage}` : ammo.damage,
    totalDamage: ammo.damage * ammo.projectileCount,
    penetration: ammo.penetrationPower,
    armorDamagePercent: ammo.armorDamage,
    fragmentationPercent: round(ammo.fragmentationChance * 100, 0),
    speedMps: ammo.initialSpeed,
    recoilModifierPercent: percent(ammo.recoilModifier),
    accuracyModifierPercent: percent(ammo.accuracyModifier),
    priceRUB: price,
    ...offerColumns(ammo, sources, limits),
    ...(price === null ? { priceNote: priceNote(ammo, sources, limits) } : {}),
  };
}

export function projectStats(stats: BuildStats) {
  return {
    ergonomics: round(stats.ergonomics, 1),
    recoilVertical: round(stats.recoilVertical, 0),
    recoilHorizontal: round(stats.recoilHorizontal, 0),
    weightKg: round(stats.weight, 3),
    costRUB: stats.costRUB === null ? null : Math.round(stats.costRUB),
    partsWithoutPrice: stats.costMissingCount,
    partCount: stats.partCount,
    unknownParts: stats.unknownCount,
  };
}

const SIGHT_LABELS = { optic: "optic", rear: "rear sight", front: "front sight" } as const satisfies Record<SightRole, string>;

/** The magazine, the sights, and anything that makes the build unusable or its cost incomplete. */
function usability(
  build: Omit<ResolvedBuild, "warnings">,
  lookup: BuildSource["lookup"],
  sources: PriceSources,
  limits: TraderLimits | null,
  factory: BuildNode | null,
  bought: BuildPurchase
) {
  const { root } = build;
  let magazine: { name: string; capacity: number | null; slotPath: string[] } | null = null;
  let magazineSlot: string[] | null = null;
  const unpriced: string[] = [];
  const walk = (node: BuildNode, path: string[]) => {
    const item = lookup.get(node.itemId);
    if (item && node !== root && !bought.owned.has(pathKey(path)) && effectivePrice(item, sources) === null) unpriced.push(item.name);
    for (const slot of item?.slots ?? []) {
      const child = childAt(node, slot.id);
      const childPath = [...path, slot.id];
      if (isMagazineSlot(slot)) {
        magazineSlot ??= childPath;
        if (child && !magazine) {
          const item = lookup.get(child.itemId);
          magazine = { name: itemName(lookup, child.itemId)!, capacity: item?.capacity ?? null, slotPath: childPath };
        }
      }
      if (child) walk(child, childPath);
    }
  };
  walk(root, []);
  const sights = checkSights(root, lookup, factory);
  const problems: string[] = [];
  if (!magazine && magazineSlot) {
    problems.push(
      `No magazine: the weapon holds one chambered round. Install one in ${slotLabel(root, lookup, magazineSlot)} (slotPath ${JSON.stringify(magazineSlot)}).`
    );
  }
  if (!sights.usable) {
    const installed = sights.sights.map((sight) => itemName(lookup, sight.itemId)).join(", ");
    const factoryParts = sights.factorySights.map((id) => itemName(lookup, id)).join(", ");
    problems.push(
      `No usable sights: no optic and no ${sights.missing.filter((kind) => kind !== "optic").join(" or ") || "iron sights"}${installed ? ` (only ${installed})` : ""}, which the default preset aims with (${factoryParts}). Install an optic${sights.missing.includes("optic") ? " or iron sights" : " or the missing iron sight"}.`
    );
  }
  const weapon = lookup.get(root.itemId);
  if (weapon && !bought.weapon) {
    problems.push(`The weapon has no price: ${priceNote(weapon, sources, limits)} costRUB leaves it out.`);
  }
  if (unpriced.length > 0) {
    problems.push(
      `${unpriced.length === 1 ? "A part has" : `${unpriced.length} parts have`} no price from the allowed sources and trader levels, so costRUB leaves ${unpriced.length === 1 ? "it" : "them"} out (see parts[].priceNote): ${unpriced.join("; ")}.`
    );
  }
  return {
    magazine,
    sights: sights.sights.map((sight) => ({
      kind: SIGHT_LABELS[sight.role],
      name: itemName(lookup, sight.itemId)!,
      slotPath: sight.path,
    })),
    problems,
  };
}

export async function describeBuild(
  context: ToolContext,
  { data, sources, limits, quests }: BuildPricing,
  build: Omit<ResolvedBuild, "warnings">
) {
  const { lookup } = data;
  const ammo = build.ammoId ? (await data.loadAmmo([build.ammoId]))[0] ?? null : null;
  const contents = await defaultPreset(data, build.root.itemId);
  const factory = contents ? reconstructPresetTree(build.root.itemId, contents, lookup) : null;
  const stats = computeStats(build.root, lookup, sources, ammo, {
    limits,
    preset: presetParts(build.root.itemId, contents, lookup),
  });
  const bought = stats.purchase;
  const parts: ({
    slotPath: string[];
    slot: string;
    itemId: string;
    name: string;
    ergonomics: number;
    recoilModifierPercent: number | null;
    comesWithWeapon?: true;
  } & Purchase)[] = [];
  const walk = (node: BuildNode, path: string[]) => {
    const item = lookup.get(node.itemId);
    const order = [
      ...(item?.slots.map((slot) => slot.id) ?? []),
      ...Object.keys(node.slots).filter((slotId) => !item?.slots.some((slot) => slot.id === slotId)),
    ];
    for (const slotId of order) {
      const child = childAt(node, slotId);
      if (!child) continue;
      const childPath = [...path, slotId];
      const part = lookup.get(child.itemId);
      parts.push({
        slotPath: childPath,
        slot: slotLabel(build.root, lookup, childPath),
        itemId: child.itemId,
        name: part?.name ?? `Unknown item (${child.itemId})`,
        ergonomics: part?.ergonomics ?? 0,
        recoilModifierPercent: part ? percent(part.recoilModifier) : null,
        ...(bought.owned.has(pathKey(childPath))
          ? { priceRUB: 0, comesWithWeapon: true as const }
          : part
            ? purchase(part, sources, limits)
            : { priceRUB: null }),
      });
      walk(child, childPath);
    }
  };
  walk(build.root, []);
  const weapon = lookup.get(build.weaponId);
  const options = ammoOptions(build.root, lookup);

  let shareLink: string | null = null;
  let shareError: string | undefined;
  try {
    shareLink = await shareLinkFor(context, build);
  } catch (error) {
    shareError = error instanceof Error ? error.message : "The build could not be shared.";
  }

  return {
    name: build.name,
    weapon: weapon
      ? {
          id: weapon.id,
          name: weapon.name,
          caliber: formatCaliber(weapon.caliber),
          caliberId: caliberId(weapon.caliber),
          fireRate: weapon.fireRate ?? null,
          url: itemUrl(context, weapon),
          ...purchase(weapon, sources, limits, bought.weapon),
          ...(bought.asPreset ? presetPurchase(bought, lookup) : {}),
        }
      : { id: build.weaponId, name: `Unknown weapon (${build.weaponId})` },
    stats: projectStats(stats),
    ammo: ammo
      ? { ...projectAmmo(ammo, sources, limits), fits: ammoFits(ammo.id, options) }
      : {
          loaded: null,
          compatibleCount: options.ids.length,
          note: "No ammo loaded, so recoil leaves out the ammo's modifier. List rounds with get_ammo_options and load one with build.ammo or set_ammo.",
        },
    ...usability(build, lookup, sources, limits, factory, bought),
    missingRequiredSlots: stats.missingRequired.map((missing) => ({
      slot: missing.label,
      slotPath: [...missing.parentPath, missing.slot.id],
      optionCount: missing.slot.allowedItemIds.length,
    })),
    conflicts: findConflicts(build.root, lookup).map((conflict) => ({
      kind: conflict.kind,
      part: `${itemName(lookup, conflict.source.node.itemId)} (${slotLabel(build.root, lookup, conflict.source.path) || "weapon"})`,
      with:
        conflict.kind === "item"
          ? `${itemName(lookup, conflict.other.node.itemId)} (${slotLabel(build.root, lookup, conflict.other.path) || "weapon"})`
          : `the occupied ${slotLabel(build.root, lookup, conflict.other.path)} slot`,
    })),
    parts,
    ...requiredTasksField(
      [
        { name: weapon?.name ?? build.weaponId, item: weapon, choice: bought.weapon },
        // Parts the weapon's preset includes needn't be bought, so their tasks don't count.
        ...parts.filter((part) => !part.comesWithWeapon).map((part) => ({ name: part.name, item: lookup.get(part.itemId) })),
        ...(ammo ? [{ name: ammo.name, item: ammo }] : []),
      ],
      sources,
      limits,
      quests
    ),
    shareLink,
    ...(shareError ? { shareError } : {}),
    ammoId: build.ammoId,
  };
}

function presetPurchase(bought: BuildPurchase, lookup: BuildSource["lookup"]) {
  const spare = [...bought.spare].map(([id, count]) => `${count > 1 ? `${count}× ` : ""}${itemName(lookup, id) ?? id}`);
  return { boughtAsPreset: true as const, ...(spare.length ? { sparePresetParts: spare } : {}) };
}

function requiredTasksField(...args: Parameters<typeof requiredTasks>) {
  const tasks = requiredTasks(...args);
  return tasks.length ? { requiredTasks: tasks } : {};
}

export function itemRow(item: BuildItemData, sources: PriceSources, limits: TraderLimits | null = null) {
  const price = effectivePrice(item, sources);
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    ergonomics: item.ergonomics,
    recoilModifierPercent: percent(item.recoilModifier),
    weightKg: round(item.weight, 3),
    priceRUB: price,
    ...offerColumns(item, sources, limits),
    ...(price === null ? { priceNote: priceNote(item, sources, limits) } : {}),
    ...(typeof item.capacity === "number" ? { capacity: item.capacity } : {}),
    ...(item.sight ? { sight: item.sight } : {}),
    slotCount: item.slots.length,
  };
}
