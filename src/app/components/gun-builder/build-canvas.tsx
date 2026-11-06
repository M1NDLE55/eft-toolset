"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import type { FlowLayout, PositionedNode } from "@/app/lib/builds/tree-layout";
import type { ItemLookup } from "@/app/lib/builds/stats";
import { cn } from "@/lib/utils";
import { BuilderNode } from "./build-node";

interface BuildCanvasProps {
  flow: FlowLayout;
  items: ItemLookup;
  loading: boolean;
  onOpen: (node: PositionedNode) => void;
  onRemove: (node: PositionedNode) => void;
  onIntent: (node: PositionedNode) => void;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
const DESKTOP_QUERY = "(min-width: 640px)";

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function subscribeMedia(listener: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

export function BuildCanvas(props: BuildCanvasProps) {
  const desktop = useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  );
  return desktop ? <TreeCanvas {...props} /> : <TreeList {...props} />;
}

function TreeCanvas({ flow, items, loading, onOpen, onRemove, onIntent }: BuildCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false
  );

  function zoomTo(next: number, anchorX?: number, anchorY?: number) {
    const container = scrollRef.current;
    const target = clampZoom(next);
    if (!container || target === scale) return;
    const x = anchorX ?? container.clientWidth / 2;
    const y = anchorY ?? container.clientHeight / 2;
    const graphX = (container.scrollLeft + x) / scale;
    const graphY = (container.scrollTop + y) / scale;
    flushSync(() => setScale(target));
    container.scrollLeft = graphX * target - x;
    container.scrollTop = graphY * target - y;
  }

  const zoomWithWheel = useEffectEvent((factor: number, x: number, y: number) => {
    zoomTo(scale * factor, x, y);
  });

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      zoomWithWheel(
        Math.exp(-event.deltaY * 0.002),
        event.clientX - rect.left,
        event.clientY - rect.top
      );
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  function fit() {
    const container = scrollRef.current;
    if (!container) return;
    const next = clampZoom(Math.min(1, (container.clientWidth - 2) / flow.width));
    flushSync(() => setScale(next));
    container.scrollTo({ left: 0, top: 0 });
  }

  async function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch {
    }
  }

  function handlePanStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-builder-node]")) return;
    const container = scrollRef.current;
    if (!container) return;
    const start = { x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop };
    container.dataset.panning = "true";
    event.preventDefault();
    const onMove = (move: PointerEvent) => {
      container.scrollLeft = start.left - (move.clientX - start.x);
      container.scrollTop = start.top - (move.clientY - start.y);
    };
    const onUp = () => {
      delete container.dataset.panning;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const toolButton =
    "flex h-8 w-8 items-center justify-center text-[#888] transition-colors hover:bg-[#151515] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative border border-[#1a1a1a] bg-[#070707]",
        isFullscreen && "flex h-screen w-screen flex-col"
      )}
    >
      <div className="absolute right-2 top-2 z-10 flex items-center border border-[#1a1a1a] bg-[#0c0c0c]/95 backdrop-blur-sm">
        <button type="button" className={toolButton} onClick={() => zoomTo(scale / 1.2)} disabled={scale <= MIN_ZOOM} aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="h-8 min-w-12 px-1 text-[10px] font-bold tabular-nums tracking-widest text-[#888] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866]"
          onClick={() => zoomTo(1)}
          aria-label="Reset zoom to 100%"
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className={toolButton} onClick={() => zoomTo(scale * 1.2)} disabled={scale >= MAX_ZOOM} aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" className={cn(toolButton, "border-l border-[#1a1a1a]")} onClick={fit} aria-label="Fit tree to width">
          <Scan className="h-4 w-4" />
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
      <div
        ref={scrollRef}
        onPointerDown={handlePanStart}
        className={cn(
          "overflow-auto overscroll-contain cursor-grab data-[panning]:cursor-grabbing data-[panning]:select-none",
          isFullscreen ? "flex-1" : "max-h-[72vh]"
        )}
      >
        <div className="relative" style={{ width: flow.width * scale, height: flow.height * scale }}>
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: flow.width, height: flow.height, transform: `scale(${scale})` }}
          >
            <svg className="pointer-events-none absolute inset-0" width={flow.width} height={flow.height} aria-hidden="true">
              {flow.edges.map((edge) => {
                const mid = edge.x1 + (edge.x2 - edge.x1) / 2;
                return (
                  <path
                    key={edge.id}
                    d={`M ${edge.x1} ${edge.y1} H ${mid} V ${edge.y2} H ${edge.x2}`}
                    fill="none"
                    stroke={edge.empty ? "#333" : "#9a8866"}
                    strokeOpacity={edge.empty ? 1 : 0.6}
                    strokeWidth="1"
                  />
                );
              })}
            </svg>
            <ul aria-label="Build parts">
              {flow.nodes.map((node) => (
                <li key={node.id}>
                  <BuilderNode
                    node={node}
                    item={node.itemId ? items.get(node.itemId) : undefined}
                    loading={loading}
                    onOpen={() => onOpen(node)}
                    onRemove={() => onRemove(node)}
                    onIntent={() => onIntent(node)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreeList({ flow, items, loading, onOpen, onRemove, onIntent }: BuildCanvasProps) {
  return (
    <ul aria-label="Build parts" className="flex flex-col border border-[#1a1a1a] bg-[#070707] p-2">
      {flow.nodes.map((node) => (
        <li key={node.id} className="flex items-stretch">
          {node.ancestorGuides.map((hasSibling, index) => (
            <span key={index} className="relative w-3 shrink-0" aria-hidden>
              {hasSibling && <span className="absolute inset-y-0 left-1/2 w-px bg-[#9a8866]/40" />}
            </span>
          ))}
          {node.path.length > 0 && (
            <span className="relative w-3 shrink-0" aria-hidden>
              <span className="absolute left-1/2 top-0 h-1/2 w-px bg-[#9a8866]/40" />
              <span className="absolute left-1/2 right-0 top-1/2 h-px bg-[#9a8866]/40" />
              {!node.isLastChild && <span className="absolute bottom-0 left-1/2 top-1/2 w-px bg-[#9a8866]/40" />}
            </span>
          )}
          <div className="flex min-w-0 flex-1 py-0.5">
            <BuilderNode
              node={node}
              item={node.itemId ? items.get(node.itemId) : undefined}
              loading={loading}
              onOpen={() => onOpen(node)}
              onRemove={() => onRemove(node)}
              onIntent={() => onIntent(node)}
              compact
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
