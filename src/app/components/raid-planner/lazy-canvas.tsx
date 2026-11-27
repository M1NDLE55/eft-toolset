"use client";

import { Component, lazy, Suspense, useState, useSyncExternalStore, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { ChunkErrorNotice } from "@/app/components/global/route-status";
import { importChunk } from "@/app/lib/chunk-load";
import { pageErrorKind } from "@/app/lib/usage/page-error";

function CanvasFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050505]">
      <span className="animate-pulse text-3xs font-bold uppercase tracking-widest text-[#666]">Loading map</span>
    </div>
  );
}

const noop = () => () => {};

/** Catches a chunk that didn't download, for the notice; anything else goes on to the page's error boundary. */
class ChunkBoundary extends Component<{ fallback: (error: unknown) => ReactNode; children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (pageErrorKind(error) !== "chunk_load") throw error;
    return this.props.fallback(error);
  }
}

/**
 * Loads a Leaflet canvas in the browser only (Leaflet needs window), with the fallback meanwhile.
 * Its code is fetched once per page and tried twice (importChunk); if it still doesn't arrive, the
 * canvas's place says so with a Retry that fetches it afresh, and the rest of the page stays.
 */
export function browserOnly<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  const make = (retry?: unknown) => lazy(() => importChunk(load, { retry }).then((module) => ({ default: pick(module) })));
  let Lazy = make();
  return function BrowserOnly(props: P) {
    const inBrowser = useSyncExternalStore(noop, () => true, () => false);
    // Bumped by Retry, so the boundary and the lazy component start over.
    const [attempt, setAttempt] = useState(0);
    if (!inBrowser) return <CanvasFallback />;
    return (
      <ChunkBoundary
        key={attempt}
        fallback={(error) => (
          <ChunkErrorNotice
            error={error}
            what="map"
            loading={<CanvasFallback />}
            onRetry={() => {
              Lazy = make(error);
              setAttempt((value) => value + 1);
            }}
          />
        )}
      >
        <Suspense fallback={<CanvasFallback />}>
          <Lazy {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  };
}

export const LazyPlanEditorCanvas = browserOnly(
  () => import("./plan-editor-canvas"),
  (module) => module.PlanEditorCanvas
);

export const LazyMapCanvas = browserOnly(
  () => import("./map-canvas"),
  (module) => module.MapCanvas
);
