"use client";

import dynamic from "next/dynamic";

function CanvasFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050505]">
      <span className="animate-pulse text-[10px] font-bold uppercase tracking-widest text-[#666]">Loading map</span>
    </div>
  );
}

export const LazyPlanEditorCanvas = dynamic(
  () => import("./plan-editor-canvas").then((module) => module.PlanEditorCanvas),
  { ssr: false, loading: CanvasFallback }
);

export const LazyMapCanvas = dynamic(() => import("./map-canvas").then((module) => module.MapCanvas), {
  ssr: false,
  loading: CanvasFallback,
});
