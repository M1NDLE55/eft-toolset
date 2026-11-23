import type { AmmoItemData } from "@/app/lib/types/gunBuilder";
import { caliberId, formatCaliber } from "@/app/lib/builds/caliber";
import { isItemSlug } from "@/app/lib/item-links";
import type { FaqEntry } from "./item";
import { formatRoubles } from "./format";

export const AMMO_HUB_TITLE = "Tarkov Ammo Chart: Penetration, Damage & Prices for Every Round";
export const AMMO_HUB_DESCRIPTION =
  "Every Escape from Tarkov round by calibre: penetration, damage, armor damage, fragmentation, speed and recoil, with live prices and where to buy. PVP and PVE.";

export interface AmmoRound {
  name: string;
  shortName: string;
  slug: string | null;
  damage: number;
  /** Pellets per shot: damage is per pellet for shotgun shells. */
  projectiles: number;
  penetration: number;
  armorDamage: number;
  fragmentation: number;
  speed: number | null;
  recoil: number;
  /** Cheapest way to buy it, or null when it's loot only. */
  price: number | null;
  source: string | null;
}

export interface Caliber {
  id: string;
  name: string;
  slug: string;
  rounds: AmmoRound[];
}

export function caliberSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cheapest(ammo: AmmoItemData): { price: number | null; source: string | null } {
  const offers = [
    ammo.traderPriceRUB ? { price: ammo.traderPriceRUB, source: ammo.traderName ?? "Trader" } : null,
    ammo.fleaPriceRUB && !ammo.fleaBanned ? { price: ammo.fleaPriceRUB, source: "Flea" } : null,
  ].filter((offer): offer is { price: number; source: string } => offer !== null);
  if (offers.length === 0) return { price: null, source: null };
  return offers.reduce((best, offer) => (offer.price < best.price ? offer : best));
}

/** Rounds grouped by calibre, most penetration first; calibres with the most rounds first. */
export function groupAmmo(ammo: readonly AmmoItemData[]): Caliber[] {
  const groups = new Map<string, Caliber>();
  for (const round of ammo) {
    const id = caliberId(round.caliber);
    const name = formatCaliber(round.caliber);
    if (!id || !name) continue;
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { id, name, slug: caliberSlug(name), rounds: [] }));
    group.rounds.push({
      name: round.name,
      shortName: round.shortName,
      slug: isItemSlug(round.normalizedName) ? round.normalizedName : null,
      damage: round.damage,
      projectiles: round.projectileCount,
      penetration: round.penetrationPower,
      armorDamage: round.armorDamage,
      fragmentation: Math.round(round.fragmentationChance * 100),
      speed: round.initialSpeed,
      recoil: round.recoilModifier,
      ...cheapest(round),
    });
  }
  for (const group of groups.values()) {
    group.rounds.sort((a, b) => b.penetration - a.penetration || b.damage - a.damage || a.name.localeCompare(b.name));
  }
  return Array.from(groups.values()).sort((a, b) => b.rounds.length - a.rounds.length || a.name.localeCompare(b.name));
}

export function caliberTitle(caliber: Pick<Caliber, "name">) {
  return `Tarkov ${caliber.name} Ammo Chart: Best Rounds, Penetration & Damage`;
}

function totalDamage(round: AmmoRound) {
  return round.damage * round.projectiles;
}

function damageText(round: AmmoRound) {
  return round.projectiles > 1 ? `${round.projectiles}×${round.damage} damage` : `${round.damage} damage`;
}

export function caliberDescription(caliber: Caliber) {
  const top = caliber.rounds[0];
  if (!top) return `Every ${caliber.name} round in Escape from Tarkov compared, with live prices.`;
  return `Best ${caliber.name} ammo in Tarkov: ${top.name} has ${top.penetration} penetration and ${damageText(top)}. All ${caliber.rounds.length} ${caliber.name} rounds compared with live prices.`;
}

export function caliberFaq(caliber: Caliber): FaqEntry[] {
  const rounds = caliber.rounds;
  if (rounds.length === 0) return [];
  const byPen = rounds[0];
  const byDamage = rounds.reduce((best, round) => (totalDamage(round) > totalDamage(best) ? round : best));
  const priced = rounds.filter((round) => round.price !== null);
  const cheapestRound = priced.reduce<AmmoRound | null>((best, round) => (!best || round.price! < best.price! ? round : best), null);
  const entries: FaqEntry[] = [
    {
      question: `What is the best ${caliber.name} ammo in Tarkov?`,
      answer: `Against armor, ${byPen.name}: it has the most penetration of any ${caliber.name} round (${byPen.penetration}), with ${damageText(byPen)}. Against unarmored targets, ${byDamage.name} hits hardest, with ${damageText(byDamage)}.`,
    },
  ];
  if (cheapestRound) {
    entries.push({
      question: `What is the cheapest ${caliber.name} ammo?`,
      answer: `${cheapestRound.name}, at about ${formatRoubles(cheapestRound.price!)} a round from ${cheapestRound.source === "Flea" ? "the flea market" : cheapestRound.source}. It has ${cheapestRound.penetration} penetration and ${damageText(cheapestRound)}.`,
    });
  }
  entries.push({
    question: "What do penetration and armor damage mean?",
    answer:
      "Penetration is how well a round goes through armor: the higher it is compared with the armor's class and condition, the more likely it goes through. Armor damage is how much of the round's damage the armor's durability takes when it's hit.",
  });
  return entries;
}

/** The highest-penetration round of the most common calibres, for the hub's FAQ. */
export function bestByCaliber(calibers: readonly Caliber[], ids: readonly string[]) {
  return ids.flatMap((id) => {
    const caliber = calibers.find((entry) => entry.id === id);
    const top = caliber?.rounds[0];
    return caliber && top ? [`${top.name} for ${caliber.name} (${top.penetration} penetration)`] : [];
  });
}
