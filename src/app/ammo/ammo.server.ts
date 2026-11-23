import { notFound } from "@tanstack/react-router";
import { readForRender } from "@/app/lib/api/server-render";
import { listBestBuildWeapons } from "@/app/lib/builds/best-builds";
import { caliberDescription, caliberTitle } from "@/app/lib/seo/ammo";
import type { GameMode } from "@/components/game-mode/mode";
import { loadCalibers } from "./load";
import type { AmmoHubData } from "./ammo-hub";
import type { CaliberPageData } from "./caliber-page";

export class AmmoUnavailableError extends Error {
  constructor() {
    super("Ammo data is temporarily unavailable.");
    this.name = "AmmoUnavailableError";
  }
}

/** The ammo chart. Fails the render rather than cache an empty chart. */
export async function loadAmmoHub(gameMode: GameMode): Promise<AmmoHubData> {
  const loaded = await loadCalibers(gameMode);
  if (!loaded) throw new AmmoUnavailableError();
  return { gameMode, calibers: loaded.calibers };
}

/** One calibre's rounds. Fails the render rather than cache a page without its rounds; an unknown calibre is a 404. */
export async function loadCaliberPage(gameMode: GameMode, slug: string): Promise<CaliberPageData> {
  const loaded = await loadCalibers(gameMode);
  if (!loaded) throw new AmmoUnavailableError();
  const caliber = loaded.calibers.find((entry) => entry.slug === slug);
  if (!caliber) throw notFound();
  const weapons = ((await readForRender("Ammo weapons", () => listBestBuildWeapons("regular"))) ?? [])
    .filter((weapon) => weapon.caliber === caliber.name)
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
  const title = caliberTitle(caliber);
  const description = caliberDescription(caliber);
  const url = `/ammo/${caliber.slug}`;
  return {
    gameMode,
    caliber,
    weapons,
    metadata: {
      title,
      description,
      alternates: { canonical: url },
      openGraph: { title: `${title} | EFT Toolset`, description, url, images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
    },
  };
}
