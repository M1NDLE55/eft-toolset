"use client";

import { Component, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Box, Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
import type { BuildNode } from "@/app/lib/types/gunBuilder";
import type { ItemLookup } from "@/app/lib/builds/stats";
import { buildScene, type ScenePart } from "@/app/lib/builds/build-scene";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ViewerLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="animate-pulse text-[10px] font-bold uppercase tracking-widest text-[#666]">Loading 3D view</span>
    </div>
  );
}

const Build3DViewer = dynamic(() => import("./build-3d-viewer"), { ssr: false, loading: ViewerLoading });

let webglSupport: boolean | undefined;

/** Whether this browser can draw WebGL, checked once with a throwaway canvas. */
function detectWebGL() {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      webglSupport = Boolean(context);
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

const subscribeNothing = () => () => {};

function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

class ViewerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Unavailable({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Box className="h-6 w-6 text-[#555]" aria-hidden />
      <p className="text-sm font-bold text-[#ccc]">{title}</p>
      <p className="max-w-sm text-xs text-[#888]">{detail}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export interface Build3DPanelProps {
  root: BuildNode;
  items: ItemLookup;
  /** The weapon's image and name while its data loads. */
  weaponFallback?: { name: string; gridImageLink: string | null };
  /** Opens the slot picker for a part or an empty slot. */
  onOpenPart: (part: ScenePart) => void;
}

export function Build3DPanel({ root, items, weaponFallback, onOpenPart }: Build3DPanelProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const supported = useSyncExternalStore(subscribeNothing, detectWebGL, () => null);
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement?.hasAttribute("data-build-3d") ?? false,
    () => false
  );
  const scene = useMemo(() => buildScene(root, items), [root, items]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [lostAttempt, setLostAttempt] = useState<number | null>(null);
  const lost = lostAttempt === attempt;

  const selected = scene.parts.find((part) => part.id === selectedId) ?? null;
  const hovered = scene.parts.find((part) => part.id === hoveredId) ?? null;
  const shown = hovered ?? selected;
  const realParts = scene.parts.filter((part) => part.role === "part").length - 1;
  const emptyParts = scene.parts.filter((part) => part.role === "empty").length;

  async function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch {
    }
  }

  function retry() {
    setAttempt((value) => value + 1);
  }

  const toolButton =
    "flex h-8 w-8 items-center justify-center text-[#888] transition-colors hover:bg-[#151515] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866]";

  if (supported === false) {
    return (
      <section aria-label="3D view" className="border border-[#1a1a1a] bg-[#070707] py-6">
        <Unavailable
          title="3D view isn't available"
          detail="This browser or device doesn't support WebGL, or it's turned off. The parts tree below shows the whole build."
        />
      </section>
    );
  }

  let viewport: ReactNode;
  if (supported === null) {
    viewport = <ViewerLoading />;
  } else if (lost) {
    viewport = (
      <Unavailable
        title="The 3D view stopped"
        detail="The graphics context was lost, which can happen when a device is low on memory."
        onRetry={retry}
      />
    );
  } else {
    viewport = (
      <ViewerBoundary
        key={attempt}
        fallback={
          <Unavailable
            title="The 3D view couldn't start"
            detail="Something went wrong loading or drawing the 3D view. The parts tree below still works."
            onRetry={retry}
          />
        }
      >
        <Build3DViewer
          scene={scene}
          selectedId={selected?.id ?? null}
          hoveredId={hovered?.id ?? null}
          resetKey={resetKey}
          onHover={setHoveredId}
          onSelect={setSelectedId}
          onContextLost={() => setLostAttempt(attempt)}
        />
      </ViewerBoundary>
    );
  }

  return (
    <section
      ref={shellRef}
      aria-label="3D view"
      data-build-3d=""
      className={cn("flex flex-col border border-[#1a1a1a] bg-[#070707]", isFullscreen && "h-screen w-screen")}
    >
      <div
        role="img"
        aria-label={`3D schematic of the build: ${realParts} part${realParts === 1 ? "" : "s"}${
          emptyParts ? `, ${emptyParts} required slot${emptyParts === 1 ? "" : "s"} empty` : ""
        }. Drag to rotate, pinch or scroll to zoom.`}
        className={cn("relative", isFullscreen ? "min-h-0 flex-1" : "h-[300px] sm:h-[420px]")}
      >
        {viewport}
        {supported && !lost && (
          <div className="absolute right-2 top-2 flex items-center border border-[#1a1a1a] bg-[#0c0c0c]/95 backdrop-blur-sm">
            <button type="button" className={toolButton} onClick={() => setResetKey((value) => value + 1)} aria-label="Reset 3D view">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn(toolButton, "border-l border-[#1a1a1a]")}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
      <PartDetails
        part={shown}
        pinned={Boolean(selected) && shown === selected}
        items={items}
        weaponFallback={weaponFallback}
        onOpen={onOpenPart}
        onClear={() => setSelectedId(null)}
      />
    </section>
  );
}

function PartDetails({
  part,
  pinned,
  items,
  weaponFallback,
  onOpen,
  onClear,
}: {
  part: ScenePart | null;
  pinned: boolean;
  items: ItemLookup;
  weaponFallback?: { name: string; gridImageLink: string | null };
  onOpen: (part: ScenePart) => void;
  onClear: () => void;
}) {
  if (!part) {
    return (
      <p className="border-t border-[#1a1a1a] px-3 py-2 text-xs text-[#888]">
        Drag to rotate, scroll or pinch to zoom. Select a part to see it or swap it. Parts are drawn as simple
        shapes placed by slot, not true-to-life models; outlines mark empty required slots.
      </p>
    );
  }
  const item = part.itemId ? items.get(part.itemId) : undefined;
  const isWeapon = part.id === "root";
  const image = item?.gridImageLink ?? (isWeapon ? weaponFallback?.gridImageLink ?? null : null);
  const name =
    part.role === "builtin"
      ? `Built into the weapon (${part.kind === "barrel" ? "barrel" : "grip"})`
      : part.role === "empty"
        ? `Empty: ${part.slot?.name ?? "slot"}`
        : item?.name ?? (isWeapon ? weaponFallback?.name : null) ?? "Loading part…";
  const where = isWeapon ? "Weapon" : part.role === "builtin" ? "Not a separate part" : part.slot?.name ?? "Slot";
  const canOpen = Boolean(part.slot) && part.role !== "builtin";

  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-[#1a1a1a] px-3 py-2" aria-live="polite">
      <span className="flex h-10 w-16 shrink-0 items-center justify-center border border-[#1a1a1a] bg-[#0c0c0c]">
        {image ? (
          <Image src={image} alt="" width={64} height={40} className="h-full w-full object-contain p-0.5" />
        ) : (
          <Box className="h-4 w-4 text-[#555]" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-bold", part.role === "empty" ? "text-[#9a8866]" : "text-[#e6d9b8]")}>{name}</p>
        <p className="truncate text-[11px] uppercase tracking-widest text-[#888]">{where}</p>
      </div>
      {pinned && canOpen && (
        <Button size="sm" variant="outline" onClick={() => onOpen(part)}>
          {part.role === "empty" ? "Choose part" : "Change part"}
        </Button>
      )}
      {pinned && (
        <Button size="icon" variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X />
        </Button>
      )}
    </div>
  );
}
