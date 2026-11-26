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

// TanStack remounts a route's error component as the router's state changes, and a Retry that
// fails again throws a new error object: each kind of failure on a URL is recorded once per page
// load, however many times it shows. The URL only tells failures apart here; it is never sent.
const reported = new Set<string>();

/** Logs a page's error and records it once: which page (its route pattern) and the kind, never the error itself. */
export function useReportPageError(error: unknown) {
  const router = useTanStackRouter();
  useEffect(() => {
    console.error(error);
    const matches = router.state.matches;
    const route = usageRoute(matches[matches.length - 1]?.routeId ?? "other");
    const errorKind = pageErrorKind(error);
    const key = `${errorKind} ${router.state.location.href}`;
    if (reported.has(key)) return;
    reported.add(key);
    trackUsage("page.error", { route, errorKind });
  }, [error, router]);
}

/** Forgets what was recorded, as a new page load does. For tests. */
export function resetReportedPageErrors() {
  reported.clear();
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
  // A download that failed again after its retry: likely the visitor's connection, so say so. A
  // chunk needs a fresh page load to be fetched again; anything else loads the page's data again.
  const kind = pageErrorKind(error);
  const connection = kind === "chunk_load" || kind === "network";
  return (
    <main className="flex justify-center flex-col gap-6 items-center p-4 flex-1">
      <div className="text-center space-y-3">
        <div className="bg-[#9a8866] text-black text-3xs font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
          {connection ? "Connection Error" : "System Error"}
        </div>
        <h1 className="text-5xl font-black tracking-[0.3em] text-[#9a8866] uppercase">
          ERROR
        </h1>
        <p className="text-2xs text-[#888] uppercase tracking-[0.3em] font-bold">
          {connection ? "Couldn’t load this page. Check your connection and try again." : "Something went wrong"}
        </p>
      </div>
      <button
        onClick={() => {
          if (kind === "chunk_load") return window.location.reload();
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

/**
 * Stands in for a lazily loaded part of a page (the map canvas) whose code didn't download, after
 * its automatic second try: a short note and a Retry that fetches the code afresh. The rest of the
 * page stays. Recorded as a page error once per page load.
 */
export function ChunkErrorNotice({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  useReportPageError(error);
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#050505] p-4 text-center">
      <p className="text-2xs font-bold uppercase tracking-widest text-[#9a8866]">Couldn&apos;t load the {what}</p>
      <p className="text-2xs text-[#888]">Check your connection and try again.</p>
      <div className="flex gap-3">
        <button
          onClick={onRetry}
          className="border border-[#9a8866] text-[#9a8866] hover:bg-[#9a8866] hover:text-black transition-colors px-4 py-1.5 text-3xs uppercase tracking-widest font-bold"
        >
          Retry
        </button>
        <button
          onClick={() => window.location.reload()}
          className="text-[#666] hover:text-[#9a8866] transition-colors px-2 py-1.5 text-3xs uppercase tracking-widest font-bold"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
