import { describe, expect, it, vi } from "vitest";
import type { QuestDetail, QuestSummary } from "@/app/lib/quests/types";
import { jpegVariant, loadOgIcon, LruCache, ogIconUrl, questOgContent, titleSize, truncate, webpToPng, type IconEntry } from "@/app/lib/seo/quest-og";
import { setPlatform } from "@/app/lib/server/platform";

const ROUBLES = "5449016a4bdc2d6f028b456f";
const icon = (id: string) => `https://assets.tarkov.dev/${id}-grid-image.webp`;

const summary: QuestSummary = {
  id: "q1",
  name: "Sanitary Standards - Part 1",
  slug: "sanitary-standards-part-1",
  trader: "Therapist",
  minPlayerLevel: 12,
  faction: null,
  kappaRequired: true,
  lightkeeperRequired: false,
  maps: ["customs"],
  requires: [],
  traderLevels: [],
  failedBy: [],
  prestige: null,
  experience: 8_400,
  needs: [
    { objectives: ["o1"], items: ["gas"], count: 2, foundInRaid: true },
    { objectives: ["o2"], items: ["salewa", "ifak"], count: 1, foundInRaid: false, label: "Hand over the item: Salewa or IFAK", alternatives: 2 },
    { objectives: ["o3"], items: [ROUBLES], count: 45_000, foundInRaid: false },
  ],
  keys: [],
  objectives: ["o1", "o2", "o3"],
  optionalObjectives: [],
  image: null,
};

const objective = (id: string, optional = false, requiredKeys: string[][] = []) => ({
  id,
  type: "giveItem",
  description: id,
  count: 1,
  foundInRaid: false,
  optional,
  maps: [],
  items: [],
  alternatives: 0,
  questItem: null,
  requiredKeys,
  conditions: [],
});

const item = (name: string, image: string | null = null) => ({ name, shortName: null, slug: null, image, buy: null, sell: null });
const noRewards = { items: [], traderStanding: [], offerUnlocks: [], skills: [], traderUnlocks: [], craftUnlocks: [] };

const detail: QuestDetail = {
  gameMode: "regular",
  quest: summary,
  wikiLink: null,
  restartable: false,
  objectives: [objective("o1"), objective("o2"), objective("o3"), objective("o4", true)],
  rewards: { ...noRewards, items: [{ id: ROUBLES, count: 30_000 }] },
  startRewards: noRewards,
  prerequisites: [],
  unlocks: [],
  chain: { before: [], after: [] },
  quests: {},
  items: {
    gas: item("Gas analyzer", icon("gas")),
    salewa: item("Salewa first aid kit", icon("salewa")),
    ifak: item("IFAK individual first aid kit"),
    [ROUBLES]: item("Roubles", icon("roubles")),
    dorm: item("Dorm room 314 marked key", icon("dorm")),
    gate: item("Military checkpoint key", icon("gate")),
  },
  maps: {
    customs: { key: "customs", name: "Customs", page: "customs" },
    "night-factory": { key: "night-factory", name: "Night Factory", page: "factory" },
    factory: { key: "factory", name: "Factory", page: "factory" },
    woods: { key: "woods", name: "Woods", page: "woods" },
    shoreline: { key: "shoreline", name: "Shoreline", page: "shoreline" },
  },
};

describe("quest share image content", () => {
  it("shows the quest's facts and badges", () => {
    const content = questOgContent(detail);
    expect(content).toMatchObject({ name: "Sanitary Standards - Part 1", trader: "Therapist", maps: ["Customs"], level: 12, badges: ["Kappa"] });
    expect(content.facts).toEqual(["3 objectives", "8,400 XP"]);
    expect(questOgContent({ ...detail, gameMode: "pve", quest: { ...summary, minPlayerLevel: 1, lightkeeperRequired: true, faction: "USEC" } })).toMatchObject({
      level: null,
      badges: ["Kappa", "Lightkeeper", "USEC only", "PVE"],
    });
  });

  it("lists the items to hand over, with alternatives in the objective's words and money by its label", () => {
    const { items, rewards } = questOgContent(detail);
    expect(rewards).toEqual([]);
    expect(items).toEqual({
      title: "Items needed",
      more: 0,
      entries: [
        { name: "Gas analyzer", image: icon("gas"), count: 2, foundInRaid: true },
        { name: "Salewa or IFAK", image: icon("salewa"), count: null, foundInRaid: false },
        { name: "45,000 ₽", image: icon("roubles"), count: null, foundInRaid: false },
      ],
    });
    const unlabelled = { ...summary, needs: [{ objectives: ["o1"], items: ["salewa", "ifak"], count: 3, foundInRaid: false, alternatives: 5 }] };
    expect(questOgContent({ ...detail, quest: unlabelled }).items?.entries[0]).toMatchObject({ name: "Salewa first aid kit or 4 others", count: 3 });
    // A label describing a task rather than the items isn't used.
    const task = { ...unlabelled, needs: [{ ...unlabelled.needs[0], label: "Launch a yellow signal flare at the train station" }] };
    expect(questOgContent({ ...detail, quest: task }).items?.entries[0].name).toBe("Salewa first aid kit or 4 others");
  });

  it("prefers keys over hand-overs, from the quest's keys or else its objectives, and counts what doesn't fit", () => {
    const keyed = { ...detail, quest: { ...summary, keys: [{ map: "customs", keys: ["dorm", "gate", "dorm"] }] } };
    expect(questOgContent(keyed).items).toEqual({
      title: "Keys needed",
      more: 0,
      entries: [
        { name: "Dorm room 314 marked key", image: icon("dorm"), count: null, foundInRaid: false },
        { name: "Military checkpoint key", image: icon("gate"), count: null, foundInRaid: false },
      ],
    });
    const fromObjectives = { ...detail, objectives: [objective("o1", false, [["gate", "unknown"]])] };
    expect(questOgContent(fromObjectives).items).toMatchObject({ title: "Key needed", entries: [{ name: "Military checkpoint key" }] });

    const many = { ...summary, needs: Array.from({ length: 6 }, (_, index) => ({ objectives: [`o${index}`], items: ["gas"], count: 1, foundInRaid: false })) };
    expect(questOgContent({ ...detail, quest: many }).items).toMatchObject({ more: 2, entries: { length: 4 } });
  });

  it("shows rewards when nothing is needed, and merges map variants", () => {
    const bare = { ...summary, needs: [], maps: ["factory", "night-factory", "customs", "woods", "shoreline"], experience: 0 };
    const content = questOgContent({ ...detail, quest: bare });
    expect(content.items).toBeNull();
    expect(content.rewards).toEqual(["30,000 ₽"]);
    expect(content.maps).toEqual(["Factory", "Customs", "+2 more"]);
    expect(content.facts).toEqual(["3 objectives"]);
  });

  it("shrinks and cuts long names", () => {
    expect(titleSize("Shortage")).toBeGreaterThan(titleSize("Sanitary Standards - Part 1"));
    expect(titleSize("The Survivalist Path - Unprotected but Dangerous")).toBe(46);
    const long = questOgContent({ ...detail, quest: { ...summary, name: "A ".repeat(60) + "very long quest name" } });
    expect(long.name.length).toBeLessThanOrEqual(72);
    expect(long.name.endsWith("…")).toBe(true);
    expect(truncate("Dorm room 314 marked key", 100)).toBe("Dorm room 314 marked key");
    expect(truncate("Military checkpoint key", 22)).toBe("Military checkpoint…");
    // No word boundary near the cut: cut mid-word rather than lose most of the text.
    expect(truncate("Military checkpoint key", 16)).toBe("Military checkp…");
    expect(truncate("  spaced   out  ", 20)).toBe("spaced out");
  });
});

describe("quest share image icons", () => {
  it("only uses tarkov.dev assets", () => {
    expect(ogIconUrl(icon("a"))).toBe(icon("a"));
    expect(ogIconUrl("http://assets.tarkov.dev/a.webp")).toBeNull();
    expect(ogIconUrl("https://static.wikia.nocookie.net/a.png")).toBeNull();
    expect(ogIconUrl("not a url")).toBeNull();
    expect(ogIconUrl(null)).toBeNull();
    expect(jpegVariant(icon("a"))).toBe("https://assets.tarkov.dev/a-grid-image.jpg");
    expect(jpegVariant("https://assets.tarkov.dev/a.png")).toBeNull();
  });

  const image = (type: string, status = 200) => new Response(new Uint8Array([1, 2, 3]), { status, headers: { "content-type": type } });

  it("converts WebP to PNG, caches the result, and shares a fetch in flight", async () => {
    const fetcher = vi.fn(async () => image("image/webp"));
    const toPng = vi.fn(async () => Buffer.from([9]));
    const cache = new LruCache<IconEntry>(10);
    const [first, second] = await Promise.all([loadOgIcon(icon("a"), { fetcher, toPng, cache }), loadOgIcon(icon("a"), { fetcher, toPng, cache })]);
    expect(first).toBe("data:image/png;base64,CQ==");
    expect(second).toBe(first);
    expect(await loadOgIcon(icon("a"), { fetcher, toPng, cache })).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(icon("a"), expect.objectContaining({ cf: { cacheTtl: expect.any(Number), cacheEverything: true } }));
  });

  it("converts with the platform's image service (Cloudflare Images), scaled to fit 160×160", async () => {
    const convert = vi.fn(async () => new Uint8Array([7, 7]));
    setPlatform({ convertImage: convert });
    try {
      expect(await webpToPng(new Uint8Array([1]))).toEqual(new Uint8Array([7, 7]));
      expect(convert).toHaveBeenCalledWith(new Uint8Array([1]), { width: 160, height: 160, format: "image/png" });
      setPlatform({ convertImage: async () => Promise.reject(new Error("over quota")) });
      expect(await webpToPng(new Uint8Array([1]))).toBeNull();
    } finally {
      setPlatform();
    }
    expect(await webpToPng(new Uint8Array([1]))).toBeNull();
  });

  it("falls back to tarkov.dev's JPEG without a converter, and to no icon at all", async () => {
    const cache = new LruCache<IconEntry>(10);
    const fetcher = vi.fn(async (url: string | URL | Request) => (String(url).endsWith(".jpg") ? image("image/jpeg") : image("image/webp")));
    expect(await loadOgIcon(icon("b"), { fetcher, toPng: async () => null, cache })).toBe("data:image/jpeg;base64,AQID");

    const failing = vi.fn(async () => image("text/html", 404));
    expect(await loadOgIcon(icon("c"), { fetcher: failing, toPng: async () => null, cache })).toBeNull();
    expect(await loadOgIcon(icon("c"), { fetcher: failing, toPng: async () => null, cache })).toBeNull();
    // The webp and the jpg once; the failure is remembered for a while.
    expect(failing).toHaveBeenCalledTimes(2);

    const throwing = vi.fn(async () => Promise.reject(new Error("offline")));
    expect(await loadOgIcon(icon("d"), { fetcher: throwing, cache })).toBeNull();
    expect(await loadOgIcon("https://example.com/x.png", { fetcher: throwing, cache })).toBeNull();
    expect(throwing).toHaveBeenCalledTimes(2);
  });

  it("doesn't follow redirects, and skips an icon too big to draw without reading it", async () => {
    const cache = new LruCache<IconEntry>(10);
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png", "content-length": String(10 * 1024 * 1024) } }));
    expect(await loadOgIcon("https://assets.tarkov.dev/big.png", { fetcher, toPng: async () => null, cache })).toBeNull();
    expect(fetcher).toHaveBeenCalledWith("https://assets.tarkov.dev/big.png", expect.objectContaining({ redirect: "error" }));
  });

  it("keeps the cache bounded, dropping the least recently used", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
  });
});
