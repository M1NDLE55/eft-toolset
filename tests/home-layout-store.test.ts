import { beforeEach, describe, expect, it } from "vitest";
import { readStore } from "@/app/lib/storage/versioned-store";
import { BACKUP_STORES } from "@/app/lib/storage/backup";
import { DEFAULT_HOME_LAYOUT, HOME_LAYOUT_STORE, setHomeLayout } from "@/app/lib/settings/store";

beforeEach(() => window.localStorage.clear());

describe("home layout setting", () => {
  it("defaults to the dashboard", () => {
    expect(DEFAULT_HOME_LAYOUT).toBe("bento");
    expect(readStore(HOME_LAYOUT_STORE)).toBe("bento");
  });

  it("persists a chosen layout", () => {
    setHomeLayout("market");
    expect(readStore(HOME_LAYOUT_STORE)).toBe("market");
  });

  it("falls back to the default for an unknown stored layout", () => {
    window.localStorage.setItem(HOME_LAYOUT_STORE.key, JSON.stringify({ version: 1, data: "carousel" }));
    expect(readStore(HOME_LAYOUT_STORE)).toBe("bento");
  });

  it("is part of the backup", () => {
    expect(BACKUP_STORES.some((store) => store.definition.key === HOME_LAYOUT_STORE.key)).toBe(true);
  });
});
