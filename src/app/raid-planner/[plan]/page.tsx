"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowLeft, LoaderCircle, Pencil } from "lucide-react";
import type { PlanTool, RaidPlan } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { getPlan, renamePlan, savePlan } from "@/app/lib/raid-planner/store";
import { fetchMapDetails } from "@/app/lib/cache/raidPlanner";
import { useGameMode } from "@/components/game-mode/context";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { FloorSwitcher } from "@/app/components/raid-planner/floor-switcher";
import { LayerPanel } from "@/app/components/raid-planner/layer-panel";
import { Toolbar } from "@/app/components/raid-planner/toolbar";
import { NoteEditor } from "@/app/components/raid-planner/note-editor";
import { SharePlan } from "@/app/components/raid-planner/share-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PlanEditorCanvas = dynamic(
  () =>
    import("@/app/components/raid-planner/plan-editor-canvas").then(
      (module) => module.PlanEditorCanvas
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  }
);

export default function PlanEditorPage() {
  const params = useParams<{ plan: string }>();
  const { gameMode } = useGameMode();

  const [plan, setPlan] = useState<RaidPlan | null>(null);
  const [tool, setTool] = useState<PlanTool>("select");
  const [color, setColor] = useState<string>(PLAN_COLORS[0]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const found = getPlan(params.plan);
    if (!found) notFound();
    setPlan(found);
    setRenameValue(found.name);
  }, [params.plan]);

  const config = plan ? getMapConfig(plan.mapKey) : undefined;

  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const [floorInitialized, setFloorInitialized] = useState(false);
  useEffect(() => {
    if (config && !floorInitialized) {
      setActiveFloor(config.floors.find((floor) => floor.show)?.id ?? null);
      setFloorInitialized(true);
    }
  }, [config, floorInitialized]);

  const [details, setDetails] = useState<MapDetails | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    setDetails(null);
    setDetailsError(false);

    fetchMapDetails(config.key, gameMode)
      .then((result) => {
        if (cancelled) return;
        setDetails(result);
        setDetailsError(!result);
      })
      .catch(() => {
        if (!cancelled) setDetailsError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [config, gameMode, retryToken]);

  const updatePlan = useCallback(
    (updater: (current: RaidPlan) => RaidPlan) => {
      setPlan((current) => (current ? savePlan(updater(current)) : current));
    },
    []
  );

  const handleLayerChange = useCallback(
    (ids: string[], checked: boolean) => {
      updatePlan((current) => {
        const next = new Set(current.enabledLayers);
        for (const id of ids) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return { ...current, enabledLayers: Array.from(next) };
      });
    },
    [updatePlan]
  );

  const layerGroups = useMemo(
    () => (details ? getLayerGroups(details) : null),
    [details]
  );
  const enabledSet = useMemo(
    () => new Set(plan?.enabledLayers ?? []),
    [plan?.enabledLayers]
  );

  if (!plan || !config) {
    return (
      <div className="flex w-full justify-center p-8">
        <LoaderCircle className="h-6 w-6 animate-spin text-[#9a8866]" />
      </div>
    );
  }

  const currentPlan = plan;
  const selectedNote =
    currentPlan.notes.find((note) => note.id === selectedNoteId) ?? null;

  function handleRename() {
    const name = renameValue.trim();
    if (!name) return;
    const updated = renamePlan(currentPlan.id, name);
    if (updated) {
      setPlan(updated);
      setRenameOpen(false);
    }
  }

  return (
    <div className="relative h-[calc(100dvh-65px)] w-full overflow-hidden">
      <PlanEditorCanvas
        key={config.key}
        config={config}
        activeFloor={activeFloor}
        details={details}
        enabledLayers={currentPlan.enabledLayers}
        plan={currentPlan}
        tool={tool}
        color={color}
        onPlanChange={updatePlan}
        onSelectNote={setSelectedNoteId}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2 border border-[#2a2a2a] bg-[#090909]/90 px-3 py-2 backdrop-blur-sm">
          <Link
            href={{ pathname: "/raid-planner" }}
            className="text-[#777] transition-colors hover:text-[#9a8866]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to plans</span>
          </Link>
          <span className="max-w-48 truncate text-sm font-bold uppercase tracking-widest text-[#9a8866] sm:max-w-xs">
            {currentPlan.name}
          </span>
          <button
            type="button"
            onClick={() => {
              setRenameValue(currentPlan.name);
              setRenameOpen(true);
            }}
            className="text-[#777] transition-colors hover:text-[#9a8866]"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="sr-only">Rename plan</span>
          </button>
          <SharePlan plan={currentPlan} />
          <span className="hidden text-[10px] uppercase tracking-widest text-[#555] sm:inline">
            {config.name}
          </span>
        </div>

        <div className="pointer-events-auto">
          <LayerPanel
            groups={layerGroups}
            enabled={enabledSet}
            onChange={handleLayerChange}
            loading={!details && !detailsError}
            error={detailsError}
            onRetry={() => setRetryToken((token) => token + 1)}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute z-[1000] p-3 max-sm:inset-x-0 max-sm:bottom-0 max-sm:flex max-sm:justify-center sm:left-0 sm:top-1/2 sm:-translate-y-1/2">
        <div className="pointer-events-auto">
          <Toolbar
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
          />
        </div>
      </div>

      {selectedNote && (
        <div className="pointer-events-none absolute bottom-0 left-0 z-[1000] p-3 pb-10 max-sm:bottom-14">
          <div className="pointer-events-auto">
            <NoteEditor
              note={selectedNote}
              onChange={(changes) =>
                updatePlan((current) => ({
                  ...current,
                  notes: current.notes.map((note) =>
                    note.id === selectedNote.id ? { ...note, ...changes } : note
                  ),
                }))
              }
              onDelete={() => {
                setSelectedNoteId(null);
                updatePlan((current) => ({
                  ...current,
                  notes: current.notes.filter(
                    (note) => note.id !== selectedNote.id
                  ),
                }));
              }}
              onClose={() => setSelectedNoteId(null)}
            />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-0 right-0 z-[1000] flex flex-col items-end gap-2 p-3 pb-24">
        <div className="pointer-events-auto">
          <FloorSwitcher
            config={config}
            activeFloor={activeFloor}
            onChange={setActiveFloor}
          />
        </div>
      </div>

      {config.author && (
        <div className="pointer-events-none absolute bottom-0 left-0 z-[999] p-3 max-sm:pb-16">
          <p className="pointer-events-auto bg-[#090909]/80 px-2 py-1 text-[10px] uppercase tracking-widest text-[#555]">
            Map by{" "}
            {config.authorLink ? (
              <a
                href={config.authorLink}
                className="text-[#9a8866] underline underline-offset-2"
              >
                {config.author}
              </a>
            ) : (
              config.author
            )}
          </p>
        </div>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename plan</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
