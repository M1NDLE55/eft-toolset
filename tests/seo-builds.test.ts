import { describe, expect, it } from "vitest";
import type { BestBuild, WeaponBestBuilds } from "@/app/lib/builds/best-builds";
import { bestBuildDescription, bestBuildFaq, bestBuildTitle, recoilReduction } from "@/app/lib/seo/builds";
import { pruneEmptyMounts } from "@/app/lib/builds/best-builds";

function build(kind: BestBuild["kind"], overrides: Partial<BestBuild> = {}): BestBuild {
  return {
    kind,
    ergonomics: 55,
    recoilVertical: 78,
    recoilHorizontal: 224,
    weight: 2.85,
    costRUB: 77_730,
    parts: [],
    shareHref: "/gun-builder/share/x#b=y",
    ...overrides,
  };
}

const result: WeaponBestBuilds = {
  gameMode: "regular",
  weapon: {
    id: "m4",
    slug: "colt-m4a1-556x45-assault-rifle",
    name: "Colt M4A1 5.56x45 assault rifle",
    shortName: "M4A1",
    gridImageLink: null,
    caliber: "5.56x45mm NATO",
    weaponClass: "Assault rifles",
  },
  builds: [
    build("preset"),
    build("recoil", { ergonomics: 37.5, recoilVertical: 49.15, recoilHorizontal: 141.25, weight: 4.39, costRUB: 721_149 }),
    build("ergonomics", { ergonomics: 97.8, recoilVertical: 68.66, recoilHorizontal: 197.33, weight: 3.67, costRUB: 502_298 }),
  ],
};

describe("best build SEO copy", () => {
  it("titles the page with the short name players search by", () => {
    expect(bestBuildTitle(result.weapon)).toBe("Best M4A1 Build in Tarkov: Lowest Recoil & Max Ergo");
  });

  it("puts the lowest recoil numbers and the change from the preset in the description", () => {
    expect(recoilReduction(result.builds[1], result.builds[0])).toBe(37);
    expect(bestBuildDescription(result)).toBe(
      "Lowest recoil M4A1 build: 49 vertical and 141 horizontal recoil (37% less than the factory preset), 38 ergonomics, about 721,149 ₽. Plus a max-ergonomics build, with every part and live prices."
    );
  });

  it("answers recoil, ergonomics and cost questions from the builds", () => {
    const faq = bestBuildFaq(result);
    expect(faq.map((entry) => entry.question)).toEqual([
      "What is the lowest recoil M4A1 build in Tarkov?",
      "What is the best ergonomics M4A1 build?",
      "How much does a meta M4A1 build cost?",
      "How are these builds chosen?",
    ]);
    expect(faq[1].answer).toBe("The max-ergonomics build reaches 98 ergonomics with 69 vertical and 197 horizontal recoil, and weighs 3.67 kg.");
    expect(faq[2].answer).toBe(
      "The lowest recoil build costs about 721,149 ₽ and the max-ergonomics build about 502,298 ₽, buying each part at the cheapest trader or flea price, starting from the 77,730 ₽ factory preset."
    );
  });

  it("leaves out the preset comparison when the weapon has no preset", () => {
    const bare = { ...result, builds: result.builds.slice(1) };
    expect(bestBuildDescription(bare)).toMatch(/^Lowest recoil M4A1 build: 49 vertical and 141 horizontal recoil, 38 ergonomics/);
  });
});

describe("empty sight mounts on best builds", () => {
  const slot = (id: string, nameId: string, required = false) => ({ id, name: id, nameId, required, allowedItemIds: [] });
  const part = (id: string, slots: ReturnType<typeof slot>[] = [], sight: "optic" | "iron" | null = null) =>
    [id, { id, name: id, slots, sight }] as const;
  const lookup = new Map([
    part("gun", [slot("scope", "mod_scope"), slot("rail", "mod_mount_000"), slot("req", "mod_scope_001", true)]),
    part("ring", [slot("cap", "mod_mount")]),
    part("cap"),
    part("rail", [slot("light", "mod_tactical")]),
    part("light"),
    part("dot", [], "optic"),
    part("base", [slot("sight", "mod_scope")]),
  ]) as unknown as Parameters<typeof pruneEmptyMounts>[1];

  it("drops a mount chain with no sight, keeps mounts holding a sight or a device, and never empties required slots", () => {
    const root = {
      itemId: "gun",
      slots: {
        scope: { itemId: "ring", slots: { cap: { itemId: "cap", slots: {} } } },
        rail: { itemId: "rail", slots: { light: { itemId: "light", slots: {} } } },
        req: { itemId: "ring", slots: {} },
      },
    };
    expect(Object.keys(pruneEmptyMounts(root, lookup).slots)).toEqual(["rail", "req"]);
    const withSight = { itemId: "gun", slots: { scope: { itemId: "base", slots: { sight: { itemId: "dot", slots: {} } } } } };
    expect(pruneEmptyMounts(withSight, lookup)).toEqual(withSight);
  });
});
