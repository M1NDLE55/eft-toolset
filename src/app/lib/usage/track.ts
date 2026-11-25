import { type DurationBucket, type PageErrorKind, type UsageOutcome, type UsageRoute, type WebEventName } from "./catalog";

/**
 * Sends one anonymous usage event from the browser to /api/usage with navigator.sendBeacon: no
 * cookie of its own, no identifier, no text the visitor typed. Fields are limited to the catalogue's
 * closed lists and a game id; the server checks them again. Nothing is sent when the browser asks
 * not to be tracked (Global Privacy Control or Do Not Track).
 */
export interface TrackFields {
  /** The weapon or item's tarkov.dev id, or the map key, for events that name one. */
  subject?: string;
  gameMode?: "regular" | "pve";
  outcome?: UsageOutcome;
  duration?: DurationBucket;
  route?: UsageRoute;
  errorKind?: PageErrorKind;
}

export const USAGE_ENDPOINT = "/api/usage";

interface PrivacyNavigator {
  globalPrivacyControl?: boolean;
  doNotTrack?: string | null;
}

/** True when the visitor has asked sites not to track them. */
export function usageOptedOut(nav: PrivacyNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator) {
  if (!nav) return true;
  const windowDnt = typeof window === "undefined" ? undefined : (window as { doNotTrack?: string | null }).doNotTrack;
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1" || nav.doNotTrack === "yes" || windowDnt === "1";
}

export function trackUsage(event: WebEventName, fields: TrackFields = {}) {
  if (usageOptedOut()) return;
  const body = JSON.stringify({ event, ...fields });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(USAGE_ENDPOINT, blob)) return;
    void fetch(USAGE_ENDPOINT, { method: "POST", body: blob, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    // Stats never get in the way of the page.
  }
}
