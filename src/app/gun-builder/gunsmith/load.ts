import { cache } from "react";
import { getGunsmithTask, listGunsmithTasks } from "@/app/lib/builds/gunsmith-pages";
import { readForRender } from "@/app/lib/api/server-render";
import type { GameMode } from "@/components/game-mode/mode";

/** Task lists match across modes, so PVP's is used. */
export const loadGunsmithTasks = cache(() => readForRender("Gunsmith list", () => listGunsmithTasks("regular")));

/** undefined: couldn't be worked out in time. null: no such task. */
export const loadGunsmithTask = cache(async (gameMode: GameMode, slug: string) =>
  readForRender("Gunsmith page", () => getGunsmithTask(gameMode, slug))
);
