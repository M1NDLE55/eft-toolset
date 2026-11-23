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
  waitForOperationSlot: async () => undefined,
  releaseOperationSlot: () => undefined,
  runTarkovRead: (work: () => Promise<unknown>) => work(),
  itemsPublishedAt: async (gameMode: "regular" | "pve") => (gameMode === "pve" ? "2026-11-19T08:30:00.000Z" : "2026-11-19T08:20:22.000Z"),
  getItemPageIndex: async () => ({
    publishedAt: "2026-11-19T08:20:22.000Z",
    pages: new Map([
      ["graphics-card", { indexing: { kind: "index" }, updated: "2026-11-19T07:08:14.000Z" }],
      ["factory-emergency-exit-key", { indexing: { kind: "index" }, updated: null }],
      ["colt-m4a1-556x45-assault-rifle-default", { indexing: { kind: "canonical", slug: "colt-m4a1-556x45-assault-rifle", reason: "default-preset" }, updated: null }],
      ["9x18mm-pm-ppe-gzh-ammo-pack-50-pcs", { indexing: { kind: "noindex", reason: "ammo-pack" }, updated: null }],
    ]),
  }),
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
    // Near-duplicates and pages kept out of search aren't listed.
    expect(urls).not.toContain("/item/colt-m4a1-556x45-assault-rifle-default");
    expect(urls).not.toContain("/item/9x18mm-pm-ppe-gzh-ammo-pack-50-pcs");
    const quests = entries.filter((entry) => entry.url.includes("/quests/"));
    expect(quests).toHaveLength(5);
    for (const entry of quests) expect(String(entry.lastModified)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const at = (path: string) => entries.find((entry) => entry.url.endsWith(path))?.lastModified;
    expect(at("/item/graphics-card")).toBe("2026-11-19T07:08:14.000Z");
    // Without the item's own date, the items data's.
    expect(at("/item/factory-emergency-exit-key")).toBe("2026-11-19T08:20:22.000Z");
    expect(at("/ammo/556x45mm")).toBe("2026-11-19T08:20:22.000Z");
    expect(at("/flea-market/pve")).toBe("2026-11-19T08:30:00.000Z");
    expect(at("/quests")).toBe(quests.map((entry) => String(entry.lastModified)).toSorted().at(-1));
    // Pages that only change with the site's code get no date rather than a made-up one.
    expect(at("/credits")).toBeUndefined();
    // Rebuilt a second later, the dates don't move.
    const again = await sitemap();
    expect(again.filter((entry) => entry.url.includes("/quests/")).map((entry) => entry.lastModified)).toEqual(quests.map((entry) => entry.lastModified));
  });
});

describe("robots.txt", () => {
  it("lets search and answer bots in, keeps training crawlers and SEO tools out, and names the sitemap", async () => {
    const { default: robots } = await import("@/app/robots");
    const { rules, sitemap } = robots();
    const groups = Array.isArray(rules) ? rules : [rules];
    const groupFor = (agent: string) => groups.find((group) => [group.userAgent].flat().includes(agent));
    for (const agent of ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-SearchBot", "*"]) {
      expect(groupFor(agent)?.allow, agent).toBe("/");
      expect(groupFor(agent)?.disallow, agent).toBeUndefined();
    }
    for (const agent of ["GPTBot", "CCBot", "Bytespider", "ClaudeBot", "Google-Extended", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot"]) {
      expect(groupFor(agent)?.disallow, agent).toBe("/");
    }
    expect(sitemap).toBe("https://www.eft-toolset.com/sitemap.xml");
  });
});
