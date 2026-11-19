"use client";

import { useEffect } from "react";
import { applyContentScale } from "@/app/lib/settings/content-scale";
import { useContentScale } from "@/app/lib/settings/store";
import { useHydrated } from "@/app/lib/storage/use-store";

/**
 * Keeps <html> in step with the content size setting after load: a change in Settings, another
 * tab or a restored backup. The inline script in the root layout applies it before first paint.
 */
export function ContentScaleSync() {
  const scale = useContentScale();
  const hydrated = useHydrated();

  useEffect(() => {
    // The hydration render reads the server default; wait for the stored value.
    if (hydrated) applyContentScale(document.documentElement, scale);
  }, [hydrated, scale]);

  return null;
}
