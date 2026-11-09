import type { AmmoItemData, BuildItemData, BuildNode, PriceSources } from "@/app/lib/types/gunBuilder";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import { findConflicts } from "@/app/lib/builds/conflicts";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import { effectivePrice } from "@/app/lib/builds/price";
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

/** "Caliber556x45NATO" → "556x45NATO". */
export function formatCaliber(caliber: string | null | undefined) {
  return caliber?.replace(/^Caliber/, "") ?? null;
}

function percent(value: number) {
  return round(value * 100, 1);
}

export function projectAmmo(ammo: AmmoItemData, sources: PriceSources) {
  return {
    id: ammo.id,
    name: ammo.name,
    shortName: ammo.shortName,
    caliber: formatCaliber(ammo.caliber),
    damage: ammo.projectileCount > 1 ? `${ammo.projectileCount}×${ammo.damage}` : ammo.damage,
    totalDamage: ammo.damage * ammo.projectileCount,
    penetration: ammo.penetrationPower,
    armorDamagePercent: ammo.armorDamage,
    fragmentationPercent: round(ammo.fragmentationChance * 100, 0),
    speedMps: ammo.initialSpeed,
    recoilModifierPercent: percent(ammo.recoilModifier),
    accuracyModifierPercent: percent(ammo.accuracyModifier),
    priceRUB: effectivePrice(ammo, sources),
    traderPriceRUB: ammo.traderPriceRUB,
    trader: ammo.traderName ? `${ammo.traderName}${ammo.traderLevel ? ` LL${ammo.traderLevel}` : ""}` : null,
    fleaPriceRUB: ammo.fleaPriceRUB,
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

export async function describeBuild(
  context: ToolContext,
  data: BuildSource,
  build: Omit<ResolvedBuild, "warnings">,
  sources: PriceSources
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
      parts.push({
        slotPath: childPath,
        slot: slotLabel(build.root, lookup, childPath),
        itemId: child.itemId,
        name: part?.name ?? `Unknown item (${child.itemId})`,
        ergonomics: part?.ergonomics ?? 0,
        recoilModifierPercent: part ? percent(part.recoilModifier) : null,
        priceRUB: part ? effectivePrice(part, sources) : null,
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
          fireRate: weapon.fireRate ?? null,
          url: itemUrl(context, weapon),
        }
      : { id: build.weaponId, name: `Unknown weapon (${build.weaponId})` },
    stats: projectStats(stats),
    ammo: ammo
      ? { ...projectAmmo(ammo, sources), fits: ammoFits(ammo.id, options) }
      : { loaded: null, compatibleCount: options.ids.length },
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

export function itemRow(item: BuildItemData, sources: PriceSources) {
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    ergonomics: item.ergonomics,
    recoilModifierPercent: percent(item.recoilModifier),
    weightKg: round(item.weight, 3),
    priceRUB: effectivePrice(item, sources),
    traderPriceRUB: item.traderPriceRUB,
    trader: item.traderName ? `${item.traderName}${item.traderLevel ? ` LL${item.traderLevel}` : ""}` : null,
    fleaPriceRUB: item.fleaPriceRUB,
    slotCount: item.slots.length,
  };
}
