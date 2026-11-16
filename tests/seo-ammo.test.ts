import { describe, expect, it } from "vitest";
import type { AmmoItemData } from "@/app/lib/types/gunBuilder";
import { caliberDescription, caliberFaq, caliberSlug, groupAmmo } from "@/app/lib/seo/ammo";

function round(name: string, overrides: Partial<AmmoItemData> = {}): AmmoItemData {
  return {
    id: name,
    normalizedName: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    shortName: name,
    gridImageLink: null,
    caliber: "Caliber556x45NATO",
    damage: 50,
    penetrationPower: 30,
    armorDamage: 40,
    fragmentationChance: 0.2,
    projectileCount: 1,
    initialSpeed: 900,
    recoilModifier: 0,
    accuracyModifier: 0,
    traderPriceRUB: null,
    fleaPriceRUB: null,
    traderName: null,
    traderLevel: null,
    ...overrides,
  };
}

describe("ammo chart", () => {
  const calibers = groupAmmo([
    round("M855", { penetrationPower: 31, damage: 54, traderPriceRUB: 339, traderName: "Peacekeeper" }),
    round("SSA AP", { penetrationPower: 57, damage: 38 }),
    round("HP", { penetrationPower: 7, damage: 79, fleaPriceRUB: 60, traderPriceRUB: 66, traderName: "Jaeger" }),
    round("Banned", { penetrationPower: 1, damage: 10, fleaPriceRUB: 5, fleaBanned: true }),
    round("Buckshot", { caliber: "Caliber12g", damage: 25, projectileCount: 8, penetrationPower: 1 }),
  ]);

  it("groups by calibre with readable names and slugs, most penetration first", () => {
    expect(calibers.map((caliber) => [caliber.name, caliber.slug])).toEqual([
      ["5.56x45mm NATO", "5-56x45mm-nato"],
      ["12 gauge", "12-gauge"],
    ]);
    expect(calibers[0].rounds.map((entry) => entry.name)).toEqual(["SSA AP", "M855", "HP", "Banned"]);
    expect(caliberSlug(".45 ACP")).toBe("45-acp");
  });

  it("prices each round at its cheapest source and skips flea prices for banned rounds", () => {
    const rounds = new Map(calibers[0].rounds.map((entry) => [entry.name, entry]));
    expect(rounds.get("HP")).toMatchObject({ price: 60, source: "Flea" });
    expect(rounds.get("M855")).toMatchObject({ price: 339, source: "Peacekeeper" });
    expect(rounds.get("Banned")).toMatchObject({ price: null, source: null });
  });

  it("answers best and cheapest from the data, counting every pellet", () => {
    expect(caliberDescription(calibers[0])).toBe(
      "Best 5.56x45mm NATO ammo in Tarkov: SSA AP has 57 penetration and 38 damage. All 4 5.56x45mm NATO rounds compared with live prices."
    );
    const faq = caliberFaq(calibers[0]);
    expect(faq[0].answer).toContain("Against unarmored targets, HP hits hardest, with 79 damage.");
    expect(faq[1].answer).toBe("HP, at about 60 ₽ a round from the flea market. It has 7 penetration and 79 damage.");
    expect(caliberDescription(calibers[1])).toContain("8×25 damage");
  });
});
