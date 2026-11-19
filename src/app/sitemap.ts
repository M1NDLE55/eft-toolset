export const dynamic = "force-dynamic";

import type { MetadataRoute } from "next";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { getQuestList, listItemSlugs, releaseOperationSlot, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import { SITE_ORIGIN as ORIGIN } from "@/app/lib/site";
import { listBestBuildWeapons } from "@/app/lib/builds/best-builds";
import { listGunsmithTasks } from "@/app/lib/builds/gunsmith-pages";
import { getAllAmmo } from "@/app/lib/api/tarkov-server";
import { groupAmmo } from "@/app/lib/seo/ammo";
import { getKeyCounts } from "@/app/lib/reference/keys";
import { questSitemapEntries, type SitemapQuest } from "@/app/lib/seo/sitemap-quests";
import { wikiLastEdited, wikiSnapshotDate } from "@/app/lib/wiki/snapshot";

async function loadSlugs<T = string>(list: () => Promise<T[]>): Promise<T[]> {
  if (!tryAcquireOperationSlot()) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      list(),
      new Promise<T[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 5_000);
      }),
    ]);
  } catch {
    return [];
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [itemSlugs, weaponSlugs, gunsmithSlugs, caliberSlugs, keyMaps, pvpQuests, pveQuests] = await Promise.all([
    loadSlugs(() => listItemSlugs()),
    loadSlugs(async () => (await listBestBuildWeapons("regular")).map((weapon) => weapon.slug)),
    loadSlugs(async () => (await listGunsmithTasks("regular")).map((task) => task.slug)),
    loadSlugs(async () => groupAmmo(await getAllAmmo("regular")).map((caliber) => caliber.slug)),
    loadSlugs(async () => (await getKeyCounts("regular")).map((map) => map.key)),
    loadSlugs(async () => (await getQuestList("regular")).quests),
    loadSlugs(async () => (await getQuestList("pve")).quests),
  ]);
  const quests = await questEntries(pvpQuests, pveQuests);
  const routes = [
    { path: "/", priority: 1, changeFrequency: "monthly" as const },
    { path: "/item", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/item-groups", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/gun-builder", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/gun-builder/best", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/gun-builder/gunsmith", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/ammo", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/keys", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/quests", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/flea-market/pve", priority: 0.8, changeFrequency: "daily" as const },
    { path: "/raid-planner", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/mcp", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/credits", priority: 0.2, changeFrequency: "yearly" as const },
    {
      path: "/policies/disclaimer-and-use-policy",
      priority: 0.2,
      changeFrequency: "yearly" as const,
    },
    ...mapConfigs.map((map) => ({
      path: `/raid-planner/map/${map.key}`,
      priority: 0.7,
      changeFrequency: "monthly" as const,
    })),
  ];
  return [
    ...routes.map((route) => ({
      url: `${ORIGIN}${route.path}`,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...caliberSlugs.map((slug) => ({
      url: `${ORIGIN}/ammo/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...keyMaps.map((map) => ({
      url: `${ORIGIN}/keys/${map}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...gunsmithSlugs.map((slug) => ({
      url: `${ORIGIN}/gun-builder/gunsmith/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...quests.map((quest) => ({
      url: `${ORIGIN}${quest.path}`,
      lastModified: quest.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...weaponSlugs.map((slug) => ({
      url: `${ORIGIN}/gun-builder/best/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...itemSlugs.map((slug) => ({
      url: `${ORIGIN}/item/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
