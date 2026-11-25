import { useEffect, useState } from "react";
import { useRouter as useTanStackRouter, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import Link from "@/app/lib/navigation/link";
import { usageRoute } from "@/app/lib/usage/catalog";
import { pageErrorKind } from "@/app/lib/usage/page-error";
import { trackUsage } from "@/app/lib/usage/track";

/** The page for an unknown URL or a missing item, quest, map or build (HTTP 404). */
export function NotFoundPage() {
  return (
    <main className="flex justify-center flex-col gap-6 items-center p-4 flex-1">
      <div className="text-center space-y-3">
        <div className="bg-[#9a8866] text-black text-3xs font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
          Error 404
        </div>
        <h1 className="text-5xl font-black tracking-[0.3em] text-[#9a8866] uppercase">
          NOT FOUND
        </h1>
        <p className="text-2xs text-[#888] uppercase tracking-[0.3em] font-bold">
          The page you&apos;re looking for doesn&apos;t exist
        </p>
      </div>
      <Link
        href="/"
        className="border border-[#9a8866] text-[#9a8866] hover:bg-[#9a8866] hover:text-black transition-colors px-6 py-2 text-xs uppercase tracking-widest font-bold"
      >
        Return to Base
      </Link>
    </main>
  );
}

// TanStack remounts a route's error component as the router's state changes: each failure (each
// error object) is reported once.
const reported = new WeakSet<object>();

/** Logs a page's error and records it once: which page (its route pattern) and the kind, never the error itself. */
export function useReportPageError(error: unknown) {
  const router = useTanStackRouter();
  useEffect(() => {
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    console.error(error);
    const matches = router.state.matches;
    trackUsage("page.error", { route: usageRoute(matches[matches.length - 1]?.routeId ?? "other"), errorKind: pageErrorKind(error) });
  }, [error, router]);
}

// URLs that have had their automatic recovery in this page session: a second failure shows the error.
const attempted = new Set<string>();
const RELOADED_KEY = "eft:reloaded-for-chunk:";

function reloadedBefore(href: string) {
  try {
    return sessionStorage.getItem(RELOADED_KEY + href) !== null;
  } catch {
    // No storage (or no browser): a reload couldn't tell it had already happened, so never reload.
    return true;
  }
}

function markReloaded(href: string) {
  try {
    sessionStorage.setItem(RELOADED_KEY + href, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * The one automatic recovery a URL's failure gets, if it hasn't had it: data that wasn't ready in
 * time, or a request that failed, loads again; a code chunk that didn't download needs a fresh page
 * load (the browser keeps the failed module), at most once per URL in the browser tab.
 */
function recoveryFor(error: unknown, href: string): "retry" | "reload" | null {
  if (attempted.has(href)) return null;
  const kind = pageErrorKind(error);
  if (kind === "unavailable" || kind === "network") return "retry";
  if (kind === "chunk_load" && !reloadedBefore(href)) return "reload";
  return null;
}

/**
 * A page whose render failed. A failure that may pass (data not ready in time, a network error, a
 * chunk that didn't download) first tries once by itself, showing a loading page while that (or any
 * load) runs; anything else, or a second failure, shows the error with a button to load it again.
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useTanStackRouter();
  useReportPageError(error);
  const loading = useRouterState({ select: (state) => state.isLoading });
  const [href] = useState(() => router.state.location.href);
  const [recovery] = useState(() => recoveryFor(error, href));
  useEffect(() => {
    if (!recovery) return;
    attempted.add(href);
    // Storage that reads but won't take the mark: a retry instead, so a reload can't loop.
    if (recovery === "reload" && markReloaded(href)) return window.location.reload();
    reset();
    void router.invalidate();
  }, [href, recovery, reset, router]);

  if (recovery || loading) {
    return (
      <main aria-busy="true" className="flex justify-center items-center p-4 flex-1">
        <span className="animate-pulse text-3xs font-bold uppercase tracking-widest text-[#666]">Loading</span>
      </main>
    );
  }
  return (
    <main className="flex justify-center flex-col gap-6 items-center p-4 flex-1">
      <div className="text-center space-y-3">
        <div className="bg-[#9a8866] text-black text-3xs font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
          System Error
        </div>
        <h1 className="text-5xl font-black tracking-[0.3em] text-[#9a8866] uppercase">
          ERROR
        </h1>
        <p className="text-2xs text-[#888] uppercase tracking-[0.3em] font-bold">
          Something went wrong
        </p>
      </div>
      <button
        onClick={() => {
          reset();
          void router.invalidate();
        }}
        className="border border-[#9a8866] text-[#9a8866] hover:bg-[#9a8866] hover:text-black transition-colors px-6 py-2 text-xs uppercase tracking-widest font-bold"
      >
        Try Again
      </button>
    </main>
  );
}
