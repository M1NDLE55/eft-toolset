import { notFound } from "@tanstack/react-router";
import { readForRender, requireForRender } from "@/app/lib/api/server-render";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { getKeyCounts, getMapKeys } from "@/app/lib/reference/keys";
import { formatRoubles } from "@/app/lib/seo/format";
import { loadQuestList } from "@/app/quests/load";
import type { GameMode } from "@/components/game-mode/mode";
import type { MapKeysPageData } from "./map-keys-page";

class KeysUnavailableError extends Error {
  constructor() {
    super("Key data is temporarily unavailable.");
    this.name = "KeysUnavailableError";
  }
}

/** Key counts per map change with patches, so the hub shows PVP's whatever the mode. */
export function loadKeyCounts() {
  return requireForRender("Keys list", () => getKeyCounts("regular"));
}

/** A map's keys for the game mode. Unknown maps and maps without keys are 404s. */
export async function loadMapKeysPage(gameMode: GameMode, mapKey: string): Promise<MapKeysPageData> {
  const config = getMapConfig(mapKey);
  if (!config) throw notFound();
  const keys = await readForRender("Map keys", () => getMapKeys(gameMode, mapKey));
  // Fail the render rather than cache a page without its keys.
  if (keys === undefined) throw new KeysUnavailableError();
  if (!keys || keys.keys.length === 0) throw notFound();
  const [counts, quests] = await Promise.all([readForRender("Keys list", () => getKeyCounts("regular")), loadQuestList(gameMode)]);

  // Quest pages by name, for names only one quest has (faction variants share theirs).
  const questSlugs: Record<string, string | null> = {};
  const tasks = new Set(keys.keys.flatMap((key) => key.tasks));
  for (const quest of quests?.gameMode === gameMode ? quests.list.quests : []) {
    if (!tasks.has(quest.name)) continue;
    questSlugs[quest.name] = quest.name in questSlugs ? null : quest.slug;
  }

  const title = `Tarkov ${config.name} Keys: Every Key, Price & What It's For`;
  const top = keys.keys.find((key) => key.buyPrice !== null);
  const description = `All ${keys.keys.length} ${config.name} keys in Escape from Tarkov with live flea and trader prices and the tasks that need them${top ? `. Most expensive: ${top.name}, about ${formatRoubles(top.buyPrice!)}` : ""}.`;
  const url = `/keys/${config.key}`;
  return {
    gameMode,
    config: { key: config.key, name: config.name },
    keys: { gameMode, ...keys },
    otherMaps: (counts ?? []).filter((map) => map.key !== config.key),
    questSlugs,
    metadata: {
      title,
      description,
      alternates: { canonical: url },
      openGraph: { title: `${title} | EFT Toolset`, description, url, images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
    },
  };
}
