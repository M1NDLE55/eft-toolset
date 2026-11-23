"use client";

import { lazy, Suspense, useSyncExternalStore, type ComponentProps, type ComponentType } from "react";

function CanvasFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050505]">
      <span className="animate-pulse text-3xs font-bold uppercase tracking-widest text-[#666]">Loading map</span>
    </div>
  );
}

const noop = () => () => {};

/** Loads a Leaflet canvas in the browser only (Leaflet needs window), with the fallback meanwhile. */
function browserOnly<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Lazy = lazy(() => load().then((component) => ({ default: component })));
  return function BrowserOnly(props: P) {
    const inBrowser = useSyncExternalStore(noop, () => true, () => false);
    if (!inBrowser) return <CanvasFallback />;
    return (
      <Suspense fallback={<CanvasFallback />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

export const LazyPlanEditorCanvas = browserOnly<ComponentProps<typeof import("./plan-editor-canvas").PlanEditorCanvas>>(() =>
  import("./plan-editor-canvas").then((module) => module.PlanEditorCanvas)
);

export const LazyMapCanvas = browserOnly<ComponentProps<typeof import("./map-canvas").MapCanvas>>(() =>
  import("./map-canvas").then((module) => module.MapCanvas)
);
