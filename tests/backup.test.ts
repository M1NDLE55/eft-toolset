import { beforeEach, describe, expect, it } from "vitest";
import { applyRestore, createBackup, parseBackup } from "@/app/lib/storage/backup";
import { readStore, writeStore } from "@/app/lib/storage/versioned-store";
import { GROUP_STORE } from "@/app/lib/item-groups/store";
import { MAX_GROUPS } from "@/app/lib/item-groups/limits";
import { GAME_MODE_STORE } from "@/components/game-mode/mode";
import { SCOUTED_STORE } from "@/app/lib/scouted-items/store";

const backup = (stores: Record<string, unknown>) =>
  JSON.stringify({ format: "eft-toolset/backup", version: 1, exportedAt: "2026-11-06T00:00:00.000Z", stores });

describe("backup and restore", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips the current data", () => {
    writeStore(GROUP_STORE, [{ name: "Keys", items: ["Factory exit key"] }]);
    const plan = parseBackup(JSON.stringify(createBackup()));
    expect(plan.entries.find((entry) => entry.key === GROUP_STORE.key)?.count).toBe(1);
  });

  it("rejects files that are not backups and skips stores that fail validation", () => {
    expect(() => parseBackup("{}")).toThrow(/not an EFT Toolset backup/);
    expect(() => parseBackup("not json")).toThrow(/not valid JSON/);
    expect(() => parseBackup(JSON.stringify({ format: "eft-toolset/backup", version: 99, stores: {} }))).toThrow(/newer version/);
    const plan = parseBackup(
      backup({ [GROUP_STORE.key]: [{ name: "", items: [] }], "eft-toolset:settings:game-mode": "pve", __proto__: { polluted: true } })
    );
    expect(plan.rejected).toEqual(["Item groups"]);
    expect(plan.entries.map((entry) => entry.label)).toEqual(["Game mode"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("merges without duplicating and replaces when asked", () => {
    writeStore(GROUP_STORE, [{ name: "Keys", items: [] }]);
    const plan = parseBackup(backup({ [GROUP_STORE.key]: [{ name: "keys", items: ["x"] }, { name: "Meds", items: [] }] }));
    applyRestore(plan, "merge");
    expect(readStore(GROUP_STORE).map((group) => group.name)).toEqual(["Keys", "Meds"]);
    applyRestore(plan, "replace");
    expect(readStore(GROUP_STORE).map((group) => group.name)).toEqual(["keys", "Meds"]);
  });

  it("leaves every store untouched when any write fails", () => {
    writeStore(GROUP_STORE, [{ name: "Keys", items: [] }]);
    writeStore(GAME_MODE_STORE, "regular");
    const plan = parseBackup(backup({ [GROUP_STORE.key]: [{ name: "Meds", items: [] }], [GAME_MODE_STORE.key]: "pve" }));
    const original = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      calls += 1;
      if (calls === 2) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    };
    try {
      expect(() => applyRestore(plan, "replace")).toThrow(/nothing was changed/);
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(readStore(GROUP_STORE).map((group) => group.name)).toEqual(["Keys"]);
    expect(readStore(GAME_MODE_STORE)).toBe("regular");
  });

  it("rejects out-of-range timestamps and escapes Discord markup", async () => {
    const { isSafeTimestamp, escapeDiscordText } = await import("@/app/lib/text-safety");
    expect(isSafeTimestamp(Date.now())).toBe(true);
    expect(isSafeTimestamp(1e100)).toBe(false);
    expect(isSafeTimestamp(1.5)).toBe(false);
    expect(escapeDiscordText("[eft-toolset.com](https://evil.example) @everyone")).not.toMatch(/\]\(|https:\/\/|@everyone/);
  });

  it("keeps current settings when merging", () => {
    writeStore(GAME_MODE_STORE, "regular");
    applyRestore(parseBackup(backup({ [GAME_MODE_STORE.key]: "pve" })), "merge");
    expect(readStore(GAME_MODE_STORE)).toBe("regular");
  });

  it("refuses a merge that would exceed a store's limit", () => {
    writeStore(GROUP_STORE, Array.from({ length: MAX_GROUPS }, (_, index) => ({ name: `G${index}`, items: [] })));
    const plan = parseBackup(backup({ [GROUP_STORE.key]: [{ name: "New", items: [] }] }));
    expect(() => applyRestore(plan, "merge")).toThrow(/exceed its limit/);
    expect(readStore(GROUP_STORE)).toHaveLength(MAX_GROUPS);
  });
});

describe("restore rollback under a storage quota", () => {
  beforeEach(() => window.localStorage.clear());

  it("frees replacement data before putting originals back", () => {
    writeStore(GROUP_STORE, Array.from({ length: 20 }, (_, index) => ({ name: `Group ${index}`, items: ["x".repeat(200)] })));
    const before = window.localStorage.getItem(GROUP_STORE.key);
    const plan = parseBackup(
      backup({
        [GROUP_STORE.key]: [{ name: "Small", items: [] }],
        [SCOUTED_STORE.key]: Array.from({ length: 20 }, (_, index) => ({ name: `${index}${"y".repeat(230)}`, gridImageLink: null })),
        "eft-toolset:settings:game-mode": "pve",
      })
    );
    const original = Storage.prototype.setItem;
    const quota = 7_000;
    Storage.prototype.setItem = function (key: string, value: string) {
      let used = 0;
      for (let index = 0; index < this.length; index += 1) {
        const existing = this.key(index)!;
        if (existing !== key) used += existing.length + (this.getItem(existing)?.length ?? 0);
      }
      if (key === "eft-toolset:settings:game-mode" || used + key.length + value.length > quota) {
        throw new DOMException("full", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
    try {
      expect(() => applyRestore(plan, "replace")).toThrow(/nothing was changed/);
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(window.localStorage.getItem(GROUP_STORE.key)).toBe(before);
  });
});
