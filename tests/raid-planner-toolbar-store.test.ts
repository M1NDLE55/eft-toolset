import { beforeEach, describe, expect, it } from "vitest";
import { TOOLBAR_STORE, updateToolbarPrefs } from "@/app/lib/raid-planner/toolbar-store";
import { readStore } from "@/app/lib/storage/versioned-store";

describe("raid planner toolbar preferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to a right-handed, expanded toolbar", () => {
    expect(readStore(TOOLBAR_STORE)).toEqual({ side: "right", collapsed: false });
  });

  it("persists changes in a versioned envelope", () => {
    updateToolbarPrefs({ side: "left" });
    updateToolbarPrefs({ collapsed: true });
    expect(JSON.parse(localStorage.getItem(TOOLBAR_STORE.key)!)).toEqual({
      version: 1,
      data: { side: "left", collapsed: true },
    });
  });

  it("recovers valid fields from damaged data", () => {
    localStorage.setItem(TOOLBAR_STORE.key, JSON.stringify({ version: 1, data: { side: "left", collapsed: "yes", extra: 1 } }));
    expect(readStore(TOOLBAR_STORE)).toEqual({ side: "left", collapsed: false });
    localStorage.setItem(TOOLBAR_STORE.key, JSON.stringify({ version: 1, data: { side: "<script>" } }));
    expect(readStore(TOOLBAR_STORE)).toEqual({ side: "right", collapsed: false });
  });

  it("refuses to persist invalid values", () => {
    expect(() => updateToolbarPrefs({ side: "up" as never })).toThrow(/refusing to persist/i);
  });
});
