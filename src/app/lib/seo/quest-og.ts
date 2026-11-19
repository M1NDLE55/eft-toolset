import { mapLabels, questName } from "@/app/lib/quests/display";
import { moneyLabel } from "@/app/lib/quests/shopping-list";
import type { QuestDetail, QuestItemNeed } from "@/app/lib/quests/types";
import { plural } from "./format";
import { rewardPhrases } from "./quests";

/** What a quest's share image shows; built here so the image route only lays it out. */
export interface QuestOgContent {
  name: string;
  /** Title font size in px, smaller for longer names so they fit in a few lines. */
  nameSize: number;
  trader: string | null;
  maps: string[];
  level: number | null;
  /** Kappa, Lightkeeper, faction, prestige and PVE markers, in that order. */
  badges: string[];
  /** Keys when the quest needs any, else the items to hand over, else null. */
  items: { title: string; entries: QuestOgItem[]; more: number } | null;
  /** Shown instead of items when there are none. */
  rewards: string[];
  facts: string[];
}

export interface QuestOgItem {
  name: string;
  /** A tarkov.dev icon URL, null without one. */
  image: string | null;
  /** How many to hand over, when more than one. */
  count: number | null;
  foundInRaid: boolean;
}

export const MAX_OG_ITEMS = 4;
const MAX_NAME = 72;
const MAX_ITEM_NAME = 38;
const MAX_MAPS = 3;
const MAX_REWARDS = 4;

/** Cuts text to `max` characters at a word boundary where one is near, with an ellipsis. */
export function truncate(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

// The title is uppercase Inter Black with wide tracking, so it runs about 0.8em a character.
// These sizes keep any name within three lines of the image's width.
export function titleSize(name: string) {
  const length = name.length;
  if (length <= 16) return 84;
  if (length <= 30) return 68;
  if (length <= 46) return 56;
  return 46;
}

// "Hand over the item: Dogtag BEAR or Dogtag USEC" names alternatives best, as "Dogtag BEAR or Dogtag USEC". Other
// objectives (launch a flare, plant an item) describe a task rather than the items, so they aren't used.
const HAND_OVER = /^hand over\s+(?:the\s+(?:found in raid\s+)?items?\s*:\s*)?/i;

function handOverLabel(label: string | undefined) {
  if (!label || !HAND_OVER.test(label)) return null;
  const rest = label.replace(HAND_OVER, "").trim();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : null;
}

function needEntry(detail: QuestDetail, need: QuestItemNeed): QuestOgItem | null {
  const [first] = need.items;
  const item = first === undefined ? undefined : detail.items[first];
  const money = first !== undefined && need.items.length === 1 ? moneyLabel(first, need.count) : null;
  if (money) return { name: money, image: item?.image ?? null, count: null, foundInRaid: false };
  const others = Math.max(need.items.length, need.alternatives ?? 0) - 1;
  const label = handOverLabel(need.label);
  // Alternatives read best as the objective words them; else the first of them and how many more.
  const name =
    others <= 0 && item
      ? truncate(item.name, MAX_ITEM_NAME)
      : label
        ? truncate(label, MAX_ITEM_NAME)
        : item
          ? `${truncate(item.name, MAX_ITEM_NAME - 8)} or ${plural(others, "other")}`
          : null;
  if (!name) return null;
  return { name, image: item?.image ?? null, count: need.count > 1 ? need.count : null, foundInRaid: need.foundInRaid };
}

function keyIds(detail: QuestDetail) {
  const ids = detail.quest.keys.flatMap((entry) => entry.keys);
  const fromObjectives = detail.objectives.flatMap((objective) => objective.requiredKeys.flat());
  return [...new Set(ids.length > 0 ? ids : fromObjectives)].filter((id) => detail.items[id]);
}

function itemsSection(detail: QuestDetail): QuestOgContent["items"] {
  const keys = keyIds(detail);
  if (keys.length > 0) {
    const entries = keys.map((id): QuestOgItem => {
      const item = detail.items[id];
      return { name: truncate(item.name, MAX_ITEM_NAME), image: item.image, count: null, foundInRaid: false };
    });
    return { title: keys.length > 1 ? "Keys needed" : "Key needed", entries: entries.slice(0, MAX_OG_ITEMS), more: Math.max(0, entries.length - MAX_OG_ITEMS) };
  }
  const entries = detail.quest.needs.map((need) => needEntry(detail, need)).filter((entry) => entry !== null);
  if (entries.length === 0) return null;
  return { title: "Items needed", entries: entries.slice(0, MAX_OG_ITEMS), more: Math.max(0, entries.length - MAX_OG_ITEMS) };
}

export function questOgContent(detail: QuestDetail): QuestOgContent {
  const { quest } = detail;
  const name = truncate(questName(quest), MAX_NAME);
  const maps = mapLabels(quest.maps, detail.maps);
  const badges = [
    quest.kappaRequired ? "Kappa" : null,
    quest.lightkeeperRequired ? "Lightkeeper" : null,
    quest.faction ? `${quest.faction} only` : null,
    // A quest only PVE has: the image would otherwise read as a PVP one.
    detail.gameMode === "pve" ? "PVE" : null,
  ].filter((badge) => badge !== null);
  const objectives = detail.objectives.filter((objective) => !objective.optional).length;
  const items = itemsSection(detail);
  return {
    name,
    nameSize: titleSize(name),
    trader: quest.trader,
    maps: maps.length > MAX_MAPS ? [...maps.slice(0, MAX_MAPS - 1), `+${maps.length - MAX_MAPS + 1} more`] : maps,
    level: quest.minPlayerLevel > 1 ? quest.minPlayerLevel : null,
    badges,
    items,
    rewards: items ? [] : rewardPhrases(detail, detail.rewards, false).slice(0, MAX_REWARDS).map((phrase) => truncate(phrase, 40)),
    facts: [
      objectives > 0 ? plural(objectives, "objective") : null,
      quest.experience > 0 ? `${quest.experience.toLocaleString("en-US")} XP` : null,
    ].filter((fact) => fact !== null),
  };
}

/** The icon URL if it's a tarkov.dev asset over https, the only images the share image uses; else null. */
export function ogIconUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "assets.tarkov.dev" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** tarkov.dev's JPEG copy of a WebP icon, which it keeps for older items only; null for any other URL. */
export function jpegVariant(url: string) {
  return /\.webp$/i.test(url) ? url.replace(/\.webp$/i, ".jpg") : null;
}

/** A small least-recently-used map: reads move an entry to the back, writes past `max` drop the front. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string) {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }

  get size() {
    return this.entries.size;
  }
}

// What the share image renderer (Satori) draws: it accepts WebP but silently draws nothing for it.
const ICON_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const MAX_ICON_BYTES = 512 * 1024;
const ICON_TIMEOUT_MS = 3_000;
// A failed icon is retried after a while, not on every render.
const FAILED_ICON_TTL_MS = 10 * 60_000;
export const ICON_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;

export type IconEntry = { dataUri: string | null; expires: number };
const iconCache = new LruCache<IconEntry>(200);
const pending = new Map<string, Promise<string | null>>();

export interface IconLoader {
  fetcher?: typeof fetch;
  /** WebP to PNG; null when it can't. */
  toPng?: (webp: Buffer) => Promise<Buffer | null>;
  cache?: LruCache<IconEntry>;
}

let sharpModule: Promise<typeof import("sharp").default | null> | undefined;

/**
 * Converts with sharp, which Next installs for its image optimizer (an optional dependency of next, not
 * one of ours), so it's loaded only when needed and may be missing: then the icon falls back to JPEG.
 */
export async function webpToPng(webp: Buffer) {
  sharpModule ??= import("sharp").then(
    (module) => module.default,
    () => null
  );
  const sharp = await sharpModule;
  if (!sharp) return null;
  try {
    return await sharp(webp).resize(160, 160, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

async function fetchImage(url: string, fetcher: typeof fetch) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS), next: { revalidate: ICON_REVALIDATE_SECONDS } });
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_ICON_BYTES ? { type, bytes } : null;
  } catch {
    // Timed out or offline: the image renders without this icon.
    return null;
  }
}

const dataUri = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;

async function fetchIcon(src: string, fetcher: typeof fetch, toPng: (webp: Buffer) => Promise<Buffer | null>) {
  const image = await fetchImage(src, fetcher);
  if (image && ICON_TYPES.has(image.type)) return dataUri(image.type, image.bytes);
  if (image?.type === "image/webp") {
    const png = await toPng(image.bytes);
    if (png) return dataUri("image/png", png);
  }
  const jpeg = jpegVariant(src);
  const fallback = jpeg ? await fetchImage(jpeg, fetcher) : null;
  return fallback && ICON_TYPES.has(fallback.type) ? dataUri(fallback.type, fallback.bytes) : null;
}

/**
 * A tarkov.dev icon as a data URI the share image can draw, or null when it can't be had in time;
 * never throws. Icons are kept in memory and fetched through Next's data cache, so each is fetched rarely.
 */
export async function loadOgIcon(url: string | null, { fetcher = fetch, toPng = webpToPng, cache = iconCache }: IconLoader = {}) {
  const src = ogIconUrl(url);
  if (!src) return null;
  const cached = cache.get(src);
  if (cached && cached.expires > Date.now()) return cached.dataUri;
  const inFlight = pending.get(src);
  if (inFlight) return inFlight;
  const load = fetchIcon(src, fetcher, toPng).then((icon) => {
    cache.set(src, { dataUri: icon, expires: icon ? Infinity : Date.now() + FAILED_ICON_TTL_MS });
    return icon;
  });
  pending.set(src, load);
  try {
    return await load;
  } finally {
    pending.delete(src);
  }
}

/** Cache-Control for the share image: a day at the CDN for a real one; briefly for a stand-in, so the real one follows soon. */
export const OG_CACHE_CONTROL = {
  quest: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  unavailable: "public, max-age=60, s-maxage=300",
  notFound: "public, max-age=3600, s-maxage=3600",
} as const;
