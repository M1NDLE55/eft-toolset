import { cache } from "react";
import { getQuestDetail, getQuestList } from "@/app/lib/api/tarkov-server";
import { readForRender, requestGameMode } from "@/app/lib/api/server-render";
import { findQuestDetail } from "@/app/lib/quests/detail-lookup";

/** The visitor's game mode's quest list, to render and to seed the client cache; undefined when it couldn't be read in time. */
export const loadQuestList = cache(async () => {
  const gameMode = await requestGameMode();
  const list = await readForRender("Quest list", () => getQuestList(gameMode));
  return list && { gameMode, list, renderedAt: Date.now() };
});

/**
 * One quest in the visitor's game mode (see `findQuestDetail`). A zone quest from the other mode gives this mode's copy,
 * and a quest only the other mode has comes from that mode (`detail.gameMode` says which), so
 * `detail.quest.slug` can differ from the slug asked for. undefined: couldn't be worked out in
 * time. null: no such quest.
 */
export const loadQuestDetail = cache(async (slug: string) => {
  const gameMode = await requestGameMode();
  return readForRender("Quest page", async () => {
    const detail = await findQuestDetail(gameMode, slug, getQuestDetail);
    return detail ? { gameMode, detail, renderedAt: Date.now() } : null;
  });
});
