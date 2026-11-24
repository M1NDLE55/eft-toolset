"use client";

import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { usageRoute } from "@/app/lib/usage/catalog";
import { trackUsage } from "@/app/lib/usage/track";

/** The leaf route's pattern ("/item/$itemName"), never the URL. */
function currentRoute(router: ReturnType<typeof useRouter>) {
  const matches = router.state.matches;
  return usageRoute(matches[matches.length - 1]?.routeId ?? "other");
}

/** One anonymous page.view per navigation (by route pattern), for unique-visitor and feature counts. */
export function UsagePageViews() {
  const router = useRouter();
  useEffect(() => {
    trackUsage("page.view", { route: currentRoute(router) });
    return router.subscribe("onResolved", (event) => {
      if (event.pathChanged) trackUsage("page.view", { route: currentRoute(router) });
    });
  }, [router]);
  return null;
}
