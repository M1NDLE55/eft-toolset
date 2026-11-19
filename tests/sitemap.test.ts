// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { questSitemapEntries } from "@/app/lib/seo/sitemap-quests";
import { wikiLastEdited, wikiSnapshotDate } from "@/app/lib/wiki/snapshot";

const quest = (name: string, slug: string | null) => ({ name, slug });

const LISTS = {
  regular: [quest("Debut", "debut"), quest("Delivery From the Past", "delivery-from-the-past"), quest("Shooter Born in Heaven", null), quest("Zone", "zone-pvp-zone")],
  pve: [quest("Debut", "debut"), quest("Zone", "zone-pve-zone"), quest("Only In PVE", "only-in-pve"), quest("Shortage", "shortage")],
};

vi.mock("@/app/lib/api/tarkov-server", () => ({
  tryAcquireOperationSlot: () => true,
  releaseOperationSlot: () => undefined,
  listItemSlugs: async () => ["graphics-card", "factory-emergency-exit-key"],
  getAllAmmo: async () => [],
  getQuestList: async (gameMode: "regular" | "pve") => ({ quests: LISTS[gameMode] }),
}));
vi.mock("@/app/lib/builds/best-builds", () => ({ listBestBuildWeapons: async () => [{ slug: "m4a1" }] }));
vi.mock("@/app/lib/builds/gunsmith-pages", () => ({ listGunsmithTasks: async () => [{ slug: "gunsmith-part-1" }] }));
vi.mock("@/app/lib/reference/keys", () => ({ getKeyCounts: async () => [{ key: "customs" }] }));
vi.mock("@/app/lib/seo/ammo", () => ({ groupAmmo: () => [{ slug: "556x45mm" }] }));

describe("quest sitemap entries", () => {
  it("lists PVP's quests and the quests only PVE has, but not PVE's copy of a zone quest", () => {
    const entries = questSitemapEntries(LISTS.regular, LISTS.pve, new Map([["Debut", "2026-10-27T23:49:15Z"]]), "2026-11-12T01:15:12Z");
    expect(entries).toEqual([
      { path: "/quests/debut", lastModified: "2026-10-27T23:49:15Z" },
      { path: "/quests/delivery-from-the-past", lastModified: "2026-11-12T01:15:12Z" },
      { path: "/quests/zone-pvp-zone", lastModified: "2026-11-12T01:15:12Z" },
      { path: "/quests/only-in-pve", lastModified: "2026-11-12T01:15:12Z" },
      { path: "/quests/shortage", lastModified: "2026-11-12T01:15:12Z" },
    ]);
  });

  it("dates quests by their wiki page's last edit, from the snapshot index", async () => {
    const edited = await wikiLastEdited(["Debut", "Delivery from the past", "No such quest", "Graphics card"], "quest");
    expect(edited.get("Debut")).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(edited.has("Delivery from the past")).toBe(true);
    expect(edited.has("No such quest")).toBe(false);
    // An item page isn't a quest's.
    expect(edited.has("Graphics card")).toBe(false);
    expect(edited.get("Debut")! <= (await wikiSnapshotDate())).toBe(true);
  });
});

describe("sitemap", () => {
  it("has every indexable route, the quest URLs from both modes and a stable lastModified for quests", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url.replace("https://www.eft-toolset.com", ""));
    expect(new Set(urls).size).toBe(urls.length);
    for (const path of [
      "/",
      "/item",
      "/quests",
      "/keys",
      "/keys/customs",
      "/ammo",
      "/ammo/556x45mm",
      "/gun-builder",
      "/gun-builder/best",
      "/gun-builder/best/m4a1",
      "/gun-builder/gunsmith",
      "/gun-builder/gunsmith/gunsmith-part-1",
      "/flea-market/pve",
      "/credits",
      "/raid-planner/map/customs",
      "/item/graphics-card",
      "/item/factory-emergency-exit-key",
      "/quests/debut",
      "/quests/delivery-from-the-past",
      "/quests/zone-pvp-zone",
      "/quests/only-in-pve",
      "/quests/shortage",
    ]) {
      expect(urls).toContain(path);
    }
    expect(urls).not.toContain("/quests/zone-pve-zone");
    const quests = entries.filter((entry) => entry.url.includes("/quests/"));
    expect(quests).toHaveLength(5);
    for (const entry of quests) expect(String(entry.lastModified)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // Rebuilt a second later, the dates don't move.
    const again = await sitemap();
    expect(again.filter((entry) => entry.url.includes("/quests/")).map((entry) => entry.lastModified)).toEqual(quests.map((entry) => entry.lastModified));
  });
});
