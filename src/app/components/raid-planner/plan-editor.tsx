"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import type { MapConfig, PlanTool, RaidPlan } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { getPlan, savePlan } from "@/app/lib/raid-planner/store";
import { updateToolbarPrefs, useToolbarPrefs, type ToolbarPrefs } from "@/app/lib/raid-planner/toolbar-store";
import { EMPTY_HISTORY, recordChange, redoStep, undoStep, type PlanHistory } from "@/app/lib/raid-planner/history";
import { loadMapSvg } from "@/app/lib/raid-planner/map-svg";
import { MAX_LAYERS, MAX_PLAN_NAME_LENGTH } from "@/app/lib/raid-planner/limits";
import { formatDistance, routeLength } from "@/app/lib/raid-planner/route";
import { useMapDetails } from "@/app/lib/cache/raidPlanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { defaultFloor, FloorSwitcher } from "./floor-switcher";
import { LayerPanel } from "./layer-panel";
import { LazyPlanEditorCanvas } from "./lazy-canvas";
import { MAP_STAGE_CLASS, MapAttribution } from "./map-chrome";
import { NoteEditor } from "./note-editor";
import { SharePlan } from "./share-plan";
import { TOOLS, Toolbar } from "./toolbar";
import { iconButton, overlayPanel } from "./ui";

type PlanUpdater = (plan: RaidPlan) => RaidPlan;

export function PlanEditor({ storedPlan, config }: { storedPlan: RaidPlan; config: MapConfig }) {
  const [draft, setDraft] = useState<RaidPlan | null>(null);
  const [history, setHistory] = useState<PlanHistory>(EMPTY_HISTORY);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [tool, setTool] = useState<PlanTool>("select");
  const [color, setColor] = useState<string>(PLAN_COLORS[0]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeFloor, setActiveFloor] = useState(() => defaultFloor(config));
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const { details, loading, error: detailsError, retry } = useMapDetails(config.key);
  const toolbarPrefs = useToolbarPrefs();

  const plan = draft ?? storedPlan;
  const layerGroups = useMemo(() => (details ? getLayerGroups(details) : null), [details]);
  const enabledSet = useMemo(() => new Set(plan.enabledLayers), [plan.enabledLayers]);
  const selectedNote = plan.notes.find((note) => note.id === selectedNoteId) ?? null;

  function persist(next: RaidPlan) {
    try {
      savePlan(next);
      setDraft(null);
      setSaveError("");
    } catch (reason) {
      setDraft(next);
      setSaveError(reason instanceof Error ? reason.message : "Could not save this plan.");
    }
  }

  function latestPlan() {
    return draft ?? getPlan(storedPlan.id) ?? storedPlan;
  }

  function updatePlan(updater: PlanUpdater, options: { undoable?: boolean } = {}) {
    const base = latestPlan();
    const next = updater(base);
    if (next === base) return;
    if (options.undoable !== false) setHistory((current) => recordChange(current, base));
    persist(next);
  }

  function step(move: typeof undoStep) {
    const result = move(history, latestPlan());
    if (!result) return;
    setHistory(result.history);
    persist(result.plan);
  }

  const undo = () => step(undoStep);
  const redo = () => step(redoStep);

  function changeLayers(ids: string[], checked: boolean) {
    const next = new Set(plan.enabledLayers);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    if (next.size > MAX_LAYERS) {
      setNotice(`A plan can enable at most ${MAX_LAYERS} layers.`);
      return;
    }
    updatePlan((current) => ({ ...current, enabledLayers: Array.from(next) }), { undoable: false });
  }

  function changeToolbarPrefs(changes: Partial<ToolbarPrefs>) {
    try {
      updateToolbarPrefs(changes);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not save toolbar settings.");
    }
  }

  function rename() {
    const name = renameValue.trim();
    if (!name) return;
    updatePlan((current) => ({ ...current, name: name.slice(0, MAX_PLAN_NAME_LENGTH) }));
    setRenameOpen(false);
  }

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "z" || (key === "y" && !event.shiftKey))) {
      event.preventDefault();
      if (key === "z" && !event.shiftKey) undo();
      else redo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      setTool("select");
      setSelectedNoteId(null);
      return;
    }
    const match = TOOLS.find((entry) => entry.shortcut.toLowerCase() === event.key.toLowerCase());
    if (match) setTool(match.tool);
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      onShortcut(event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (config.svgPath) void loadMapSvg(config.svgPath).catch(() => undefined);
  }, [config.svgPath]);

  const status = saveError || notice;

  return (
    <div className={MAP_STAGE_CLASS}>
      <LazyPlanEditorCanvas
        config={config}
        activeFloor={activeFloor}
        details={details}
        enabledLayers={plan.enabledLayers}
        plan={plan}
        tool={tool}
        color={color}
        interactive
        onPlanChange={updatePlan}
        onSelectNote={setSelectedNoteId}
        onLimitError={setNotice}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-1001 flex items-start gap-2 p-2 sm:p-3">
        <div className={cn(overlayPanel, "pointer-events-auto flex min-w-0 items-center max-sm:flex-1")}>
          <Link href="/raid-planner" className={iconButton} title="Back to plans">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="sr-only">Back to plans</span>
          </Link>
          <div className="min-w-0 flex-1 px-1 sm:max-w-xs">
            <h1 className="truncate text-xs font-bold uppercase tracking-widest text-[#c9b88d] sm:text-sm">
              {plan.name || "Untitled raid"}
            </h1>
            <p className="truncate text-[10px] uppercase tracking-widest text-[#888]">
              {config.name}
              {plan.route.length > 1 ? ` · ${formatDistance(routeLength(plan.route))} route` : ""}
              {details?.raidDuration ? ` · ${details.raidDuration} min` : ""}
              {details?.players ? ` · ${details.players} players` : ""}
            </p>
          </div>
          <button
            type="button"
            title="Rename plan"
            onClick={() => {
              setRenameValue(plan.name);
              setRenameOpen(true);
            }}
            className={iconButton}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            <span className="sr-only">Rename plan</span>
          </button>
          <SharePlan plan={plan} />
        </div>

        <div className="pointer-events-auto ml-auto">
          <LayerPanel
            groups={layerGroups}
            enabled={enabledSet}
            onChange={changeLayers}
            loading={loading}
            error={detailsError}
            onRetry={retry}
          />
        </div>
      </div>

      {status && (
        <div
          role={saveError ? "alert" : "status"}
          className={cn(
            overlayPanel,
            "absolute left-1/2 z-1001 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-3 py-1 pl-3 pr-1 text-xs max-sm:top-[3.75rem] sm:top-3",
            saveError ? "border-red-900/60 text-red-200" : "text-[#ddd]"
          )}
        >
          <span className="min-w-0 py-2">{saveError ? `Not saved: ${saveError}` : notice}</span>
          {saveError && draft && (
            <button
              type="button"
              onClick={() => persist(draft)}
              className="h-9 shrink-0 px-3 text-[10px] font-bold uppercase tracking-widest text-[#ddd] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#9a8866]"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute z-1000 max-sm:bottom-[max(0.5rem,env(safe-area-inset-bottom))] sm:left-3 sm:top-16",
          toolbarPrefs.side === "right" ? "max-sm:right-2" : "max-sm:left-2"
        )}
      >
        <div className="pointer-events-auto">
          <Toolbar
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={undo}
            onRedo={redo}
            prefs={toolbarPrefs}
            onPrefsChange={changeToolbarPrefs}
          />
        </div>
      </div>

      {selectedNote && (
        <div className="pointer-events-none absolute z-1001 max-sm:inset-x-2 max-sm:top-16 sm:bottom-12 sm:left-16">
          <div className="pointer-events-auto">
            <NoteEditor
              key={selectedNote.id}
              note={selectedNote}
              onChange={(changes) =>
                updatePlan((current) => {
                  const target = current.notes.find((note) => note.id === selectedNote.id);
                  if (!target) return current;
                  return {
                    ...current,
                    notes: current.notes.map((note) => (note === target ? { ...note, ...changes } : note)),
                  };
                })
              }
              onDelete={() => {
                setSelectedNoteId(null);
                updatePlan((current) => ({
                  ...current,
                  notes: current.notes.filter((note) => note.id !== selectedNote.id),
                }));
              }}
              onClose={() => setSelectedNoteId(null)}
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-auto absolute z-1000 max-sm:bottom-[max(0.5rem,env(safe-area-inset-bottom))] sm:bottom-24 sm:right-3",
          toolbarPrefs.side === "right" ? "max-sm:left-2" : "max-sm:right-2"
        )}
      >
        <FloorSwitcher config={config} activeFloor={activeFloor} onChange={setActiveFloor} />
      </div>

      <MapAttribution config={config} className="left-2 top-[3.75rem] sm:bottom-3 sm:left-3 sm:top-auto" />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              rename();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename plan</DialogTitle>
            </DialogHeader>
            <Input
              value={renameValue}
              maxLength={MAX_PLAN_NAME_LENGTH}
              aria-label="Plan name"
              onChange={(event) => setRenameValue(event.target.value)}
              className="max-sm:text-base"
            />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameValue.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
