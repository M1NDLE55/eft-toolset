import { cache } from "react";
import { getQuestDetail, getQuestList } from "@/app/lib/api/tarkov-server";
import { readForRender } from "@/app/lib/api/server-render";
import { findQuestDetail } from "@/app/lib/quests/detail-lookup";
import type { GameMode } from "@/components/game-mode/mode";

/**
 * The game mode's quest list, to render and to seed the client cache; undefined when it couldn't be
 * read in time. A page that can go without it passes how long to wait for a due refresh.
 */
export const loadQuestList = cache(async (gameMode: GameMode, staleWaitMs?: number) => {
  const list = await readForRender("Quest list", () => getQuestList(gameMode), staleWaitMs);
  return list && { gameMode, list, renderedAt: Date.now() };
});

/**
 * One quest in the game mode (see `findQuestDetail`). A zone quest from the other mode gives this mode's copy,
 * and a quest only the other mode has comes from that mode (`detail.gameMode` says which), so
 * `detail.quest.slug` can differ from the slug asked for. undefined: couldn't be worked out in
 * time. null: no such quest.
 */
export const loadQuestDetail = cache(async (gameMode: GameMode, slug: string) =>
  readForRender("Quest page", async () => {
    const detail = await findQuestDetail(gameMode, slug, getQuestDetail);
    return detail ? { gameMode, detail, renderedAt: Date.now() } : null;
  })
);
