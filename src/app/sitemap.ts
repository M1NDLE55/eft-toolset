import type { MetadataRoute } from "next";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

const ORIGIN = "https://www.eft-toolset.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "/", priority: 1, changeFrequency: "monthly" as const },
    { path: "/item", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/item-groups", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/gun-builder", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/raid-planner", priority: 0.8, changeFrequency: "weekly" as const },
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
  return routes.map((route) => ({
    url: `${ORIGIN}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
