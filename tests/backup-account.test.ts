import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { sharingEndpoint } from "@/app/lib/sharing/server/router";
import { userObject } from "@/app/lib/durable/access";
import { parseBackup, restoreToAccount } from "@/app/lib/storage/backup";
import { BACKUP_FORMAT, BACKUP_VERSION, STORE_KEYS } from "@/app/lib/storage/store-keys";
import { CONTENT_SCALE_STORE } from "@/app/lib/settings/content-scale";
import { readStore } from "@/app/lib/storage/versioned-store";
import type { AccountLibrary } from "@/app/lib/account-sync/account-library";
import { durableEnv } from "./helpers/durable-env";

const weapon = "5447a9cd4bdc2dbd208b4567";
const now = Date.now();

function backup() {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    stores: {
      [STORE_KEYS.gunBuilds]: [
        { id: "b1", name: "M4", weaponId: weapon, root: { itemId: weapon, slots: {} }, createdAt: now, updatedAt: now },
        { id: "b2", name: "M4 copy", weaponId: weapon, root: { itemId: weapon, slots: {} }, createdAt: now, updatedAt: now },
      ],
      [STORE_KEYS.itemGroups]: [{ name: "Keys", items: ["Dorm room 314 marked key"] }],
      [STORE_KEYS.raidPlans]: [
        { id: "p1", name: "Night", mapKey: "customs", createdAt: now, updatedAt: now, enabledLayers: [], route: [{ id: "w", position: { x: 1, z: 1 } }], drawings: [], notes: [] },
        {
          id: "p2",
          name: "Too big",
          mapKey: "customs",
          createdAt: now,
          updatedAt: now,
          enabledLayers: [],
          route: [],
          drawings: [],
          notes: Array.from({ length: 101 }, (_, index) => ({ id: `n${index}`, position: { x: 0, z: 0 }, title: "", body: "", color: "#c8b384" })),
        },
      ],
      [CONTENT_SCALE_STORE.key]: CONTENT_SCALE_STORE.defaultValue(),
    },
  });
}

/** The account library's request(), pointed at the real routes and Durable Objects. */
function library(user: string) {
  return {
    async request(path: string, init: RequestInit = {}) {
      const request = new Request(`http://localhost:3000${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: `eft_dev_user=${user}` },
      });
      return sharingEndpoint(request)!(request);
    },
    async catchUp() {},
  } as unknown as AccountLibrary;
}

let durable: ReturnType<typeof durableEnv>;

beforeEach(() => {
  vi.stubEnv("DEV_AUTH", "1");
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
});

describe("restoring a backup while signed in", () => {
  it("adds builds, groups and plans to the account, reports what didn't fit, keeps settings in the browser, and never adds twice", async () => {
    const report = await restoreToAccount(parseBackup(backup()), library("restorer"), "merge");
    expect(report).toMatchObject({ created: 4, duplicates: 0, failed: [expect.stringMatching(/^Too big: .*100 notes/)] });
    expect(await userObject(durable.env, "user_dev_restorer").usage()).toMatchObject({ builds: 2, itemGroups: 1, ownedPlans: 1 });
    // Library data went to the account, not the browser; settings were restored here as before.
    expect(window.localStorage.getItem(STORE_KEYS.gunBuilds)).toBeNull();
    expect(readStore(CONTENT_SCALE_STORE)).toEqual(CONTENT_SCALE_STORE.defaultValue());

    const again = await restoreToAccount(parseBackup(backup()), library("restorer"), "merge");
    expect(again).toMatchObject({ created: 0, duplicates: 4 });
  });
});
