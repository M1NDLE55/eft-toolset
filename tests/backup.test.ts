import { beforeEach, describe, expect, it } from "vitest";
import { applyRestore, createBackup, parseBackup } from "@/app/lib/storage/backup";
import { readStore, writeStore } from "@/app/lib/storage/versioned-store";
import { GROUP_STORE } from "@/app/lib/item-groups/store";
import { MAX_GROUPS } from "@/app/lib/item-groups/limits";

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

  it("refuses a merge that would exceed a store's limit", () => {
    writeStore(GROUP_STORE, Array.from({ length: MAX_GROUPS }, (_, index) => ({ name: `G${index}`, items: [] })));
    const plan = parseBackup(backup({ [GROUP_STORE.key]: [{ name: "New", items: [] }] }));
    expect(() => applyRestore(plan, "merge")).toThrow(/exceed its limit/);
    expect(readStore(GROUP_STORE)).toHaveLength(MAX_GROUPS);
  });
});
