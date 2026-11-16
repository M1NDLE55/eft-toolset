import type { BestBuild, BestBuildWeapon, WeaponBestBuilds } from "@/app/lib/builds/best-builds";
import type { FaqEntry } from "./item";
import { formatRoubles } from "./format";

export const BEST_BUILDS_HUB_NAME = "Best weapon builds";
export const BEST_BUILDS_HUB_TITLE = "Best Tarkov Weapon Builds: Lowest Recoil & Meta Builds for Every Gun";
export const BEST_BUILDS_HUB_DESCRIPTION =
  "The lowest recoil and highest ergonomics build for every Escape from Tarkov weapon, worked out by the gun builder's optimiser with live flea and trader prices. Every part, stats and cost, ready to open and tweak.";

export function bestBuildTitle(weapon: Pick<BestBuildWeapon, "shortName">) {
  return `Best ${weapon.shortName} Build in Tarkov: Lowest Recoil & Max Ergo`;
}

export function round(value: number | null, digits = 0) {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function findBuild(result: WeaponBestBuilds, kind: BestBuild["kind"]) {
  return result.builds.find((build) => build.kind === kind) ?? null;
}

/** "37% less" when the build beats the preset's vertical recoil by at least 1%. */
export function recoilReduction(build: BestBuild | null, preset: BestBuild | null) {
  if (!build?.recoilVertical || !preset?.recoilVertical) return null;
  const percent = Math.round((1 - build.recoilVertical / preset.recoilVertical) * 100);
  return percent >= 1 ? percent : null;
}

function recoilText(build: BestBuild) {
  return `${round(build.recoilVertical)} vertical and ${round(build.recoilHorizontal)} horizontal recoil`;
}

export function bestBuildDescription(result: WeaponBestBuilds) {
  const { shortName } = result.weapon;
  const recoil = findBuild(result, "recoil");
  const preset = findBuild(result, "preset");
  if (!recoil) {
    return `The lowest recoil and highest ergonomics ${shortName} builds in Escape from Tarkov, with every part, live prices and stats.`;
  }
  const reduction = recoilReduction(recoil, preset);
  let description = `Lowest recoil ${shortName} build: ${recoilText(recoil)}`;
  description += reduction ? ` (${reduction}% less than the factory preset)` : "";
  description += `, ${round(recoil.ergonomics)} ergonomics`;
  description += recoil.costRUB !== null ? `, about ${formatRoubles(recoil.costRUB)}.` : ".";
  return `${description} Plus a max-ergonomics build, with every part and live prices.`;
}

export function bestBuildFaq(result: WeaponBestBuilds): FaqEntry[] {
  const { shortName } = result.weapon;
  const recoil = findBuild(result, "recoil");
  const ergo = findBuild(result, "ergonomics");
  const preset = findBuild(result, "preset");
  const entries: FaqEntry[] = [];
  if (recoil) {
    const reduction = recoilReduction(recoil, preset);
    entries.push({
      question: `What is the lowest recoil ${shortName} build in Tarkov?`,
      answer:
        `The optimiser's lowest recoil ${shortName} build has ${recoilText(recoil)}` +
        (reduction ? `, ${reduction}% less vertical recoil than the factory preset` : "") +
        `, with ${round(recoil.ergonomics)} ergonomics. Its parts are listed above, and you can open it in the gun builder to change them.`,
    });
  }
  if (ergo) {
    entries.push({
      question: `What is the best ergonomics ${shortName} build?`,
      answer: `The max-ergonomics build reaches ${round(ergo.ergonomics)} ergonomics with ${recoilText(ergo)}, and weighs ${round(ergo.weight, 2)} kg.`,
    });
  }
  const priced = [recoil, ergo].filter((build): build is BestBuild => build?.costRUB != null);
  if (priced.length) {
    entries.push({
      question: `How much does a meta ${shortName} build cost?`,
      answer:
        priced
          .map((build, index) => {
            const name = build.kind === "recoil" ? "lowest recoil" : "max-ergonomics";
            return index === 0
              ? `The ${name} build costs about ${formatRoubles(build.costRUB!)}`
              : `the ${name} build about ${formatRoubles(build.costRUB!)}`;
          })
          .join(" and ") +
        ", buying each part at the cheapest trader or flea price" +
        (preset?.costRUB != null ? `, starting from the ${formatRoubles(preset.costRUB)} factory preset.` : "."),
    });
  }
  entries.push({
    question: "How are these builds chosen?",
    answer:
      "The gun builder's optimiser searches every compatible part that can be bought from traders or the flea market, keeps a magazine at least as large as the preset's and sights of the same kind, and picks the combination with the lowest recoil or highest ergonomics. Sight mounts with nothing on them are left off. Builds update as prices and parts change.",
  });
  return entries;
}
