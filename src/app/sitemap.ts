export const dynamic = "force-dynamic";

import type { MetadataRoute } from "next";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { getItemPageIndex, getQuestList, itemsPublishedAt, releaseOperationSlot, tryAcquireOperationSlot, type ItemPageIndex } from "@/app/lib/api/tarkov-server";
import { SITE_ORIGIN as ORIGIN } from "@/app/lib/site";
import { listBestBuildWeapons } from "@/app/lib/builds/best-builds";
import { listGunsmithTasks } from "@/app/lib/builds/gunsmith-pages";
import { getAllAmmo } from "@/app/lib/api/tarkov-server";
import { groupAmmo } from "@/app/lib/seo/ammo";
import { getKeyCounts } from "@/app/lib/reference/keys";
import { questSitemapEntries, type SitemapQuest } from "@/app/lib/seo/sitemap-quests";
import { itemSitemapEntries } from "@/app/lib/seo/item-index";
import { wikiLastEdited, wikiSnapshotDate } from "@/app/lib/wiki/snapshot";

async function load<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  if (!tryAcquireOperationSlot()) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 5_000);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    releaseOperationSlot();
  }
}

/** Quest pages with their wiki page's last edit; without the snapshot they're still listed, undated. */
async function questEntries(pvp: readonly SitemapQuest[], pve: readonly SitemapQuest[]) {
  try {
    const [edited, snapshotDate] = await Promise.all([wikiLastEdited([...pvp, ...pve].map((quest) => quest.name), "quest"), wikiSnapshotDate()]);
    return questSitemapEntries(pvp, pve, edited, snapshotDate);
  } catch {
    return questSitemapEntries(pvp, pve, new Map(), "").map(({ path }) => ({ path, lastModified: undefined }));
  }
}

const NO_ITEMS: ItemPageIndex = { pages: new Map(), publishedAt: null };
const latest = (dates: (string | null | undefined)[]) => dates.reduce<string | undefined>((max, date) => (date && (!max || date > max) ? date : max), undefined);

/**
 * lastModified is set where we know when the page's content changed: an item page from tarkov.dev's
 * update time for that item, a quest page from its wiki page's last edit, and the pages built from
 * item prices (ammo, keys, builds, the flea market) from when tarkov.dev last published items.
 * Pages whose content only changes with the site's code (the home page, tools, policies) have none.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [items, pveItems, weaponSlugs, gunsmithSlugs, caliberSlugs, keyMaps, pvpQuests, pveQuests] = await Promise.all([
    load(() => getItemPageIndex("regular"), NO_ITEMS),
    load(() => itemsPublishedAt("pve"), null),
    load(async () => (await listBestBuildWeapons("regular")).map((weapon) => weapon.slug), []),
    load(async () => (await listGunsmithTasks("regular")).map((task) => task.slug), []),
    load(async () => groupAmmo(await getAllAmmo("regular")).map((caliber) => caliber.slug), []),
    load(async () => (await getKeyCounts("regular")).map((map) => map.key), []),
    load(async () => (await getQuestList("regular")).quests, []),
    load(async () => (await getQuestList("pve")).quests, []),
  ]);
  const quests = await questEntries(pvpQuests, pveQuests);
  const prices = items.publishedAt ?? undefined;
  type Route = { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; lastModified?: string };
  const routes: Route[] = [
    { path: "/", priority: 1, changeFrequency: "monthly" },
    { path: "/item", priority: 0.9, changeFrequency: "weekly", lastModified: prices },
    { path: "/item-groups", priority: 0.4, changeFrequency: "monthly", lastModified: prices },
    { path: "/gun-builder", priority: 0.8, changeFrequency: "weekly" },
    { path: "/gun-builder/best", priority: 0.8, changeFrequency: "weekly", lastModified: prices },
    { path: "/gun-builder/gunsmith", priority: 0.8, changeFrequency: "weekly", lastModified: prices },
    { path: "/ammo", priority: 0.8, changeFrequency: "weekly", lastModified: prices },
    { path: "/keys", priority: 0.7, changeFrequency: "weekly", lastModified: prices },
    { path: "/quests", priority: 0.8, changeFrequency: "weekly", lastModified: latest(quests.map((quest) => quest.lastModified)) },
    { path: "/flea-market/pve", priority: 0.8, changeFrequency: "daily", lastModified: pveItems ?? undefined },
    { path: "/raid-planner", priority: 0.8, changeFrequency: "weekly" },
    { path: "/mcp", priority: 0.5, changeFrequency: "monthly" },
    { path: "/credits", priority: 0.2, changeFrequency: "yearly" },
    { path: "/policies/disclaimer-and-use-policy", priority: 0.2, changeFrequency: "yearly" },
    ...mapConfigs.map((map): Route => ({ path: `/raid-planner/map/${map.key}`, priority: 0.7, changeFrequency: "monthly" })),
    ...caliberSlugs.map((slug): Route => ({ path: `/ammo/${slug}`, changeFrequency: "weekly", priority: 0.7, lastModified: prices })),
    ...keyMaps.map((map): Route => ({ path: `/keys/${map}`, changeFrequency: "weekly", priority: 0.6, lastModified: prices })),
    ...gunsmithSlugs.map((slug): Route => ({ path: `/gun-builder/gunsmith/${slug}`, changeFrequency: "weekly", priority: 0.7, lastModified: prices })),
    ...quests.map((quest): Route => ({ path: quest.path, changeFrequency: "weekly", priority: 0.6, lastModified: quest.lastModified })),
    ...weaponSlugs.map((slug): Route => ({ path: `/gun-builder/best/${slug}`, changeFrequency: "weekly", priority: 0.7, lastModified: prices })),
    ...itemSitemapEntries(items.pages).map((item): Route => ({ path: item.path, changeFrequency: "daily", priority: 0.6, lastModified: item.lastModified ?? prices })),
  ];
  return routes.map((route) => ({
    url: `${ORIGIN}${route.path}`,
    ...(route.lastModified ? { lastModified: route.lastModified } : {}),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
