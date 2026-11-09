export const dynamic = "force-dynamic";

import type { MetadataRoute } from "next";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { listItemSlugs, releaseOperationSlot, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import { SITE_ORIGIN as ORIGIN } from "@/app/lib/site";

async function loadItemSlugs(): Promise<string[]> {
  if (!tryAcquireOperationSlot()) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      listItemSlugs(),
      new Promise<string[]>((resolve) => {
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const itemSlugs = await loadItemSlugs();
  const routes = [
    { path: "/", priority: 1, changeFrequency: "monthly" as const },
    { path: "/item", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/item-groups", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/gun-builder", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/raid-planner", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/mcp", priority: 0.5, changeFrequency: "monthly" as const },
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
    ...itemSlugs.map((slug) => ({
      url: `${ORIGIN}/item/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
