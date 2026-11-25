import { notFound } from "@tanstack/react-router";
import { RenderDataUnavailableError } from "@/app/lib/render-errors";
import { isItemSlug } from "@/app/lib/item-links";
import { bestBuildDescription, bestBuildTitle } from "@/app/lib/seo/builds";
import { gunsmithDescription, gunsmithTitle } from "@/app/lib/seo/gunsmith";
import type { GameMode } from "@/components/game-mode/mode";
import { loadBestBuildWeapons, loadWeaponBestBuilds } from "./best/load";
import { loadGunsmithTask, loadGunsmithTasks } from "./gunsmith/load";
import type { BestBuildsPageData } from "./best/best-builds-page";
import type { GunsmithPageData } from "./gunsmith/gunsmith-page";

/** Every weapon with a best-build page; fails the render rather than cache an empty list. */
export async function loadBestBuildsHub() {
  const weapons = await loadBestBuildWeapons();
  if (!weapons) throw new RenderDataUnavailableError("Best builds list");
  return weapons;
}

/** A weapon's best builds for the game mode. The optimiser runs here, at most once per cached render. */
export async function loadBestBuildsPage(gameMode: GameMode, slug: string): Promise<BestBuildsPageData> {
  if (!isItemSlug(slug)) throw notFound();
  const result = await loadWeaponBestBuilds(gameMode, slug);
  if (result === null) throw notFound();
  if (result === undefined) throw new RenderDataUnavailableError("Best builds page");
  const weapons = (await loadBestBuildWeapons()) ?? [];
  const sameCaliber = weapons
    .filter((weapon) => weapon.caliber && weapon.caliber === result.weapon.caliber && weapon.slug !== slug)
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
  const sameClass = weapons
    .filter((weapon) => weapon.weaponClass === result.weapon.weaponClass && weapon.slug !== slug && !sameCaliber.includes(weapon))
    .sort((a, b) => a.shortName.localeCompare(b.shortName))
    .slice(0, 24);
  const title = bestBuildTitle(result.weapon);
  const description = bestBuildDescription(result);
  const url = `/gun-builder/best/${slug}`;
  return {
    gameMode,
    slug,
    result,
    sameCaliber,
    sameClass,
    metadata: {
      title,
      description,
      alternates: { canonical: url },
      openGraph: {
        title: `${title} | EFT Toolset`,
        description,
        url,
        type: "article",
        images: result.weapon.gridImageLink ? [{ url: result.weapon.gridImageLink }] : [{ url: "/home-og-image.png", width: 1200, height: 630 }],
      },
      twitter: { card: "summary", title: `${title} | EFT Toolset`, description },
    },
  };
}

/** Every weapon build task; fails the render rather than cache an empty list. */
export async function loadGunsmithHub() {
  const tasks = await loadGunsmithTasks();
  if (!tasks) throw new RenderDataUnavailableError("Gunsmith list");
  return tasks;
}

/** A weapon build task and a build that meets it, for the game mode. */
export async function loadGunsmithPage(gameMode: GameMode, slug: string): Promise<GunsmithPageData> {
  if (!isItemSlug(slug)) throw notFound();
  const view = await loadGunsmithTask(gameMode, slug);
  if (view === null) throw notFound();
  if (view === undefined) throw new RenderDataUnavailableError("Gunsmith page");
  const tasks = (await loadGunsmithTasks()) ?? [];
  const index = tasks.findIndex((entry) => entry.slug === slug);
  const neighbours = [tasks[index - 1], tasks[index + 1]].filter((entry) => entry && index >= 0);
  const title = gunsmithTitle(view);
  const description = gunsmithDescription(view);
  const url = `/gun-builder/gunsmith/${slug}`;
  return {
    gameMode,
    slug,
    view,
    neighbours,
    metadata: {
      title,
      description,
      alternates: { canonical: url },
      openGraph: { title: `${title} | EFT Toolset`, description, url, type: "article", images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title: `${title} | EFT Toolset`, description },
    },
  };
}
