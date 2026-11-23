import { notFound, redirect } from "@tanstack/react-router";
import { readForRender } from "@/app/lib/api/server-render";
import { isItemSlug } from "@/app/lib/item-links";
import { getKeyCounts } from "@/app/lib/reference/keys";
import { readQuestWiki } from "@/app/lib/wiki/quest-wiki";
import { loadGunsmithTasks } from "@/app/gun-builder/gunsmith/load";
import type { GameMode } from "@/components/game-mode/mode";
import { loadQuestDetail, loadQuestList } from "./load";
import { questMetadata, type QuestPageData } from "./quest-page";

class QuestsUnavailableError extends Error {
  constructor() {
    super("Quest data is temporarily unavailable.");
    this.name = "QuestsUnavailableError";
  }
}

/** The game mode's quest list. Fails the render rather than cache an empty list. */
export async function loadQuestsHub(gameMode: GameMode) {
  const loaded = await loadQuestList(gameMode);
  if (!loaded) throw new QuestsUnavailableError();
  return loaded;
}

/**
 * One quest. Unknown quests are 404s; a quest that couldn't be read in time fails the render. A
 * zone quest asked for under the other mode's slug redirects (temporarily) to this mode's copy.
 */
export async function loadQuestPage(gameMode: GameMode, slug: string): Promise<QuestPageData> {
  if (!isItemSlug(slug)) throw notFound();
  const loaded = await loadQuestDetail(gameMode, slug);
  if (loaded === null) throw notFound();
  if (loaded === undefined) throw new QuestsUnavailableError();
  const { detail } = loaded;
  const { quest } = detail;
  if (quest.slug && quest.slug !== slug) throw redirect({ href: `/quests/${quest.slug}`, statusCode: 307 });

  const builds = detail.objectives.some((objective) => objective.type === "buildWeapon");
  const [wiki, keyMaps, questList, gunsmith] = await Promise.all([
    readQuestWiki({ wikiLink: detail.wikiLink, name: quest.name }),
    readForRender("Keys list", () => getKeyCounts("regular")),
    loadQuestList(gameMode),
    builds ? loadGunsmithTasks() : undefined,
  ]);
  const traderQuests =
    questList && questList.gameMode === detail.gameMode ? questList.list.quests.filter((entry) => entry.trader === quest.trader && entry.slug) : [];
  const index = traderQuests.findIndex((entry) => entry.id === quest.id);
  return {
    gameMode,
    slug,
    detail,
    wiki,
    mapsWithKeys: (keyMaps ?? []).map((map) => map.key),
    buildPage: quest.slug && gunsmith?.some((task) => task.slug === quest.slug) ? `/gun-builder/gunsmith/${quest.slug}` : null,
    neighbours: index >= 0 ? [traderQuests[index - 1], traderQuests[index + 1]].filter((entry) => entry !== undefined) : [],
    metadata: questMetadata(detail, slug),
  };
}
