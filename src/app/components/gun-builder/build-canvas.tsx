"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type {
  BuildItemData,
  GunBuild,
  PriceSources,
} from "@/app/lib/types/gunBuilder";
import type { GameMode } from "@/components/game-mode/context";
import type { PositionedNode } from "@/app/lib/builds/layout";
import { Button } from "@/components/ui/button";
import { layoutBuild } from "@/app/lib/builds/layout";
import { attachMod, removeMod, saveBuild } from "@/app/lib/builds/store";
import { collectItemIds, collectOccupiedSlotIds } from "@/app/lib/builds/tree";
import { BuilderNode } from "./build-node";
import { SlotPicker } from "./slot-picker";

interface BuildCanvasProps {
  build: GunBuild;
  itemData: Map<string, BuildItemData>;
  gameMode: GameMode;
  priceSources: PriceSources;
  onBuildChange: (build: GunBuild) => void;
  loadBuildItems: (ids: string[]) => Promise<BuildItemData[]>;
}

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.8;
const BUTTON_ZOOM_STEP = 1.2;
const WHEEL_ZOOM_SPEED = 0.001;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function BuildCanvas({
  build,
  itemData,
  gameMode,
  priceSources,
  onBuildChange,
  loadBuildItems,
}: BuildCanvasProps) {
  const [activeNode, setActiveNode] = useState<PositionedNode | null>(null);
  const flow = useMemo(() => layoutBuild(build.root, itemData), [build.root, itemData]);
  const installedItemIds = useMemo(
    () => collectItemIds(build.root),
    [build.root]
  );
  const occupiedSlotIds = useMemo(
    () => collectOccupiedSlotIds(build.root),
    [build.root]
  );
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();

      const rect = container!.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);

      setViewport((current) => {
        const scale = clampZoom(current.scale * zoomFactor);
        const graphX = (pointX - current.x) / current.scale;
        const graphY = (pointY - current.y) / current.scale;

        return {
          x: pointX - graphX * scale,
          y: pointY - graphY * scale,
          scale,
        };
      });
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === canvasShellRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function zoomToPoint(
    pointX: number,
    pointY: number,
    getNextScale: (currentScale: number) => number
  ) {
    setViewport((current) => {
      const scale = clampZoom(getNextScale(current.scale));
      const graphX = (pointX - current.x) / current.scale;
      const graphY = (pointY - current.y) / current.scale;

      return {
        x: pointX - graphX * scale,
        y: pointY - graphY * scale,
        scale,
      };
    });
  }

  function zoomFromCenter(getNextScale: (currentScale: number) => number) {
    const container = viewportRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    zoomToPoint(rect.width / 2, rect.height / 2, getNextScale);
  }

  async function toggleFullscreen() {
    const shell = canvasShellRef.current;
    if (!shell) return;

    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
      return;
    }

    await shell.requestFullscreen();
  }

  // Drag empty canvas space by translating the diagram instead of relying on
  // scroll offsets, which keeps panning unbounded.
  function handlePanStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-builder-node]")) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startViewport = viewport;
    setIsPanning(true);
    event.preventDefault();

    function onMove(moveEvent: PointerEvent) {
      setViewport({
        ...startViewport,
        x: startViewport.x + moveEvent.clientX - startX,
        y: startViewport.y + moveEvent.clientY - startY,
      });
    }
    function onUp() {
      setIsPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  async function handleSelect(itemId: string) {
    if (!activeNode?.slot) return;
    await loadBuildItems([itemId]);
    const updated = saveBuild({
      ...build,
      root: attachMod(
        build.root,
        activeNode.parentPath,
        activeNode.slot.id,
        itemId
      ),
    });
    onBuildChange(updated);
    setActiveNode(null);
  }

  function handleRemove(node: PositionedNode) {
    const updated = saveBuild({
      ...build,
      root: removeMod(build.root, node.path),
    });
    onBuildChange(updated);
  }

  return (
    <>
      <div
        ref={canvasShellRef}
        className={`border border-[#1a1a1a] bg-[#050505] ${
          isFullscreen ? "h-screen w-screen" : ""
        }`}
      >
        <div
          ref={viewportRef}
          onPointerDown={handlePanStart}
          className={`relative hidden overflow-hidden sm:block ${
            isFullscreen ? "h-screen max-h-none" : "max-h-[75vh]"
          } ${
            isPanning ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div
            className="absolute right-3 top-3 z-10 flex border border-[#1a1a1a] bg-[#080808]"
            data-builder-node
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 border-r border-[#1a1a1a]"
              onClick={() => zoomFromCenter((scale) => scale / BUTTON_ZOOM_STEP)}
              disabled={viewport.scale <= MIN_ZOOM}
            >
              <ZoomOut className="h-4 w-4" />
              <span className="sr-only">Zoom out</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 border-r border-[#1a1a1a]"
              onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
              disabled={
                viewport.x === 0 && viewport.y === 0 && viewport.scale === 1
              }
            >
              <RotateCcw className="h-4 w-4" />
              <span className="sr-only">Reset canvas view</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 border-r border-[#1a1a1a]"
              onClick={() => zoomFromCenter((scale) => scale * BUTTON_ZOOM_STEP)}
              disabled={viewport.scale >= MAX_ZOOM}
            >
              <ZoomIn className="h-4 w-4" />
              <span className="sr-only">Zoom in</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
              <span className="sr-only">
                {isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              </span>
            </Button>
          </div>
          <div
            className="relative select-none"
            style={{
              width: flow.width,
              height: flow.height,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={flow.width}
              height={flow.height}
              aria-hidden="true"
            >
              {flow.edges.map((edge) => {
                const mid = edge.x1 + (edge.x2 - edge.x1) / 2;
                return (
                  <path
                    key={edge.id}
                    d={`M ${edge.x1} ${edge.y1} C ${mid} ${edge.y1}, ${mid} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                    fill="none"
                    stroke="#9a8866"
                    strokeOpacity="0.65"
                    strokeWidth="1"
                  />
                );
              })}
            </svg>
            {flow.nodes.map((node) => (
              <BuilderNode
                key={node.id}
                node={node}
                item={node.itemId ? itemData.get(node.itemId) ?? null : null}
                onOpenPicker={() => setActiveNode(node)}
                onRemove={() => handleRemove(node)}
                portalContainer={canvasShellRef.current}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 p-3 sm:hidden">
          {flow.nodes.map((node) => (
            <div key={node.id} style={{ marginLeft: node.path.length * 18 }}>
              <BuilderNode
                node={node}
                item={node.itemId ? itemData.get(node.itemId) ?? null : null}
                onOpenPicker={() => setActiveNode(node)}
                onRemove={() => handleRemove(node)}
                portalContainer={canvasShellRef.current}
                compact
              />
            </div>
          ))}
        </div>
      </div>
      <SlotPicker
        open={Boolean(activeNode?.slot)}
        slot={activeNode?.slot ?? null}
        currentItemId={activeNode?.itemId ?? null}
        itemData={itemData}
        installedItemIds={installedItemIds}
        occupiedSlotIds={occupiedSlotIds}
        gameMode={gameMode}
        priceSources={priceSources}
        portalContainer={canvasShellRef.current}
        onOpenChange={(open) => {
          if (!open) setActiveNode(null);
        }}
        onSelect={handleSelect}
      />
    </>
  );
}