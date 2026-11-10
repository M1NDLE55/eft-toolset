import type { AmmoItemData, BuildItemData, BuildNode, PriceSources, TraderOffer } from "@/app/lib/types/gunBuilder";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import { findConflicts } from "@/app/lib/builds/conflicts";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import { effectivePrice, offerAllowed, type TraderLimits } from "@/app/lib/builds/price";
import { checkSights, isMagazineSlot, type SightRole } from "@/app/lib/builds/sights";
import { itemName, slotLabel, type BuildSource, type ResolvedBuild } from "@/app/lib/builds/resolve";
import { encodeBuildSharePayload, slugifyBuildName } from "@/app/lib/builds/share";
import { computeStats, type BuildStats } from "@/app/lib/builds/stats";
import { childAt } from "@/app/lib/builds/tree";
import { round, type ToolContext } from "./context";
import { itemUrl } from "./sources";

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

/** Why an item has no price from the enabled sources and the player's trader levels. */
export function priceNote(
  item: { traderOffers?: readonly TraderOffer[]; fleaBanned?: boolean; fleaPriceRUB: number | null },
  sources: PriceSources,
  limits: TraderLimits | null
) {
  const offers = item.traderOffers ?? [];
  let trader: string;
  if (!sources.traders) trader = "trader prices are turned off";
  else if (offers.length === 0) trader = "no trader sells it";
  else {
    const locked = limits ? offers.filter((offer) => !offerAllowed(offer, limits)) : [];
    trader = locked.length
      ? `only ${locked.map((offer) => `${offer.trader}${offer.level ? ` LL${offer.level}` : ""}`).join(" or ")} sells it, above the allowed trader levels`
      : "it has no trader price";
  }
  const flea = item.fleaBanned
    ? "it is banned on the flea market"
    : !sources.flea
      ? "flea prices are turned off"
      : "it has no flea price";
  const lootOnly = item.fleaBanned && offers.length === 0 ? " Only found in raid, bartered, or crafted." : "";
  return `Can't be bought: ${trader}, and ${flea}.${lootOnly}`;
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
    traderPriceRUB: ammo.traderPriceRUB,
    trader: ammo.traderName ? `${ammo.traderName}${ammo.traderLevel ? ` LL${ammo.traderLevel}` : ""}` : null,
    fleaPriceRUB: ammo.fleaPriceRUB,
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
  limits: TraderLimits | null
) {
  const { root } = build;
  let magazine: { name: string; capacity: number | null; slotPath: string[] } | null = null;
  let magazineSlot: string[] | null = null;
  const unpriced: string[] = [];
  const walk = (node: BuildNode, path: string[]) => {
    const item = lookup.get(node.itemId);
    if (item && effectivePrice(item, sources) === null) unpriced.push(item.name);
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
  const sights = checkSights(root, lookup);
  const problems: string[] = [];
  if (!magazine && magazineSlot) {
    problems.push(
      `No magazine: the weapon holds one chambered round. Install one in ${slotLabel(root, lookup, magazineSlot)} (slotPath ${JSON.stringify(magazineSlot)}).`
    );
  }
  if (!sights.usable) {
    const installed = sights.sights.map((sight) => itemName(lookup, sight.itemId)).join(", ");
    problems.push(
      `No usable sights: no optic and no ${sights.missing.join(" or ")}${installed ? ` (only ${installed})` : ""}. Install an optic or the missing iron sight.`
    );
  }
  const weapon = lookup.get(root.itemId);
  if (weapon && effectivePrice(weapon, sources) === null) {
    problems.push(`The weapon has no price: ${priceNote(weapon, sources, limits)} costRUB leaves it out.`);
    unpriced.shift();
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
  data: BuildSource,
  build: Omit<ResolvedBuild, "warnings">,
  sources: PriceSources,
  limits: TraderLimits | null = null
) {
  const { lookup } = data;
  const ammo = build.ammoId ? (await data.loadAmmo([build.ammoId]))[0] ?? null : null;
  const stats = computeStats(build.root, lookup, sources, ammo);
  const parts: {
    slotPath: string[];
    slot: string;
    itemId: string;
    name: string;
    ergonomics: number;
    recoilModifierPercent: number | null;
    priceRUB: number | null;
    priceNote?: string;
  }[] = [];
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
      const price = part ? effectivePrice(part, sources) : null;
      parts.push({
        slotPath: childPath,
        slot: slotLabel(build.root, lookup, childPath),
        itemId: child.itemId,
        name: part?.name ?? `Unknown item (${child.itemId})`,
        ergonomics: part?.ergonomics ?? 0,
        recoilModifierPercent: part ? percent(part.recoilModifier) : null,
        priceRUB: price,
        ...(part && price === null ? { priceNote: priceNote(part, sources, limits) } : {}),
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
    ...usability(build, lookup, sources, limits),
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
    shareLink,
    ...(shareError ? { shareError } : {}),
    ammoId: build.ammoId,
  };
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
    traderPriceRUB: item.traderPriceRUB,
    trader: item.traderName ? `${item.traderName}${item.traderLevel ? ` LL${item.traderLevel}` : ""}` : null,
    fleaPriceRUB: item.fleaPriceRUB,
    ...(price === null ? { priceNote: priceNote(item, sources, limits) } : {}),
    ...(typeof item.capacity === "number" ? { capacity: item.capacity } : {}),
    ...(item.sight ? { sight: item.sight } : {}),
    slotCount: item.slots.length,
  };
}
