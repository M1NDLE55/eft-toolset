"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, FileUp, Map as MapIcon, Plus, Trash2 } from "lucide-react";
import type { MapConfig, RaidPlan } from "@/app/lib/raid-planner/types";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { createPlan, deletePlan, duplicatePlan, importPlans, usePlans } from "@/app/lib/raid-planner/store";
import { downloadPlanFile, readPlanFile } from "@/app/lib/raid-planner/plan-file";
import { prefetchMap } from "@/app/lib/raid-planner/prefetch";
import { MAX_PLAN_NAME_LENGTH } from "@/app/lib/raid-planner/limits";
import { useHydrated } from "@/app/lib/storage/use-store";
import { useGameMode } from "@/components/game-mode/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MapLinks, MapPicker } from "@/app/components/raid-planner/map-picker";
import { eyebrow, focusRing } from "@/app/components/raid-planner/ui";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export default function RaidPlannerPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const plans = usePlans();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function run(action: () => void, fallback: string) {
    setNotice("");
    try {
      action();
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : fallback);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file || importing) return;
    setImporting(true);
    setNotice("");
    try {
      const imported = importPlans(await readPlanFile(file));
      setActionError("");
      setNotice(`Imported ${plural(imported.length, "plan")} from ${file.name}.`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not import this file.");
    } finally {
      setImporting(false);
    }
  }

  function isFileDrag(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleCreate(config: MapConfig) {
    run(() => {
      const plan = createPlan(createName.trim() || `${config.name} raid`, config.key);
      setCreateOpen(false);
      router.push(`/raid-planner/${plan.id}`);
    }, "Could not create this plan.");
  }

  const createDialog = (
    <Dialog
      open={createOpen}
      onOpenChange={(open) => {
        setCreateOpen(open);
        if (open) setCreateName("");
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New plan
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
          <DialogDescription>Name it, then pick the map. You can rename it later.</DialogDescription>
        </DialogHeader>
        <Input
          value={createName}
          maxLength={MAX_PLAN_NAME_LENGTH}
          aria-label="Plan name"
          onChange={(event) => setCreateName(event.target.value)}
          placeholder="Plan name (optional)"
          className="shrink-0 max-sm:text-base"
        />
        <div className="-mx-1 min-h-0 overflow-y-auto px-1 pb-1">
          <MapPicker onPick={handleCreate} />
        </div>
        {actionError && createOpen && (
          <p role="alert" className="text-sm text-red-300">
            {actionError}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );

  return (
    <div
      className="relative flex justify-center px-4 py-6 sm:py-10"
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragging(false);
        void importFile(event.dataTransfer.files[0]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-[#9a8866] bg-black/80">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[#e6d9b8]">
            <FileUp className="h-5 w-5" aria-hidden />
            Drop a plan file to import it
          </p>
        </div>
      )}
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-black uppercase tracking-widest text-[#9a8866]">Raid Planner</h1>
            <p className="mt-1 max-w-xl text-sm text-[#999]">
              Draw routes, arrows and callouts on interactive maps, then share the plan with your squad as a link.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 max-sm:w-full">
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void importFile(file);
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={!hydrated || importing}
              title="Import plans from a .json file"
              className="max-sm:flex-1"
            >
              <FileUp aria-hidden />
              {importing ? "Importing…" : "Import"}
            </Button>
            <Button
              variant="outline"
              onClick={() => run(() => downloadPlanFile(plans), "Could not export your plans.")}
              disabled={!hydrated || plans.length === 0}
              title="Download every plan as a .json file"
              className="max-sm:flex-1"
            >
              <Download aria-hidden />
              Export all
            </Button>
            <div className="max-sm:w-full max-sm:[&>button]:w-full">{createDialog}</div>
          </div>
        </header>

        {actionError && !createOpen && (
          <p role="alert" className="border border-red-900/60 bg-[#090909] px-3 py-2 text-sm text-red-200">
            {actionError}
          </p>
        )}
        {notice && !actionError && (
          <p role="status" className="border border-[#9a8866]/50 bg-[#0e0d0b] px-3 py-2 text-sm text-[#e6d9b8]">
            {notice}
          </p>
        )}

        <section aria-labelledby="plans-heading" className="flex flex-col gap-3">
          <h2 id="plans-heading" className={eyebrow}>
            Your plans{hydrated && plans.length > 0 ? ` · ${plans.length}` : ""}
          </h2>
          {!hydrated ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {[0, 1].map((index) => (
                <div key={index} className="h-[66px] animate-pulse border border-[#1d1d1d] bg-[#0c0c0c]" />
              ))}
            </div>
          ) : plans.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  onDuplicate={() =>
                    run(() => {
                      const copy = duplicatePlan(plan.id);
                      if (copy) router.push(`/raid-planner/${copy.id}`);
                    }, "Could not duplicate this plan.")
                  }
                  onExport={() => run(() => downloadPlanFile([plan]), "Could not export this plan.")}
                  onDelete={() => run(() => deletePlan(plan.id), "Could not delete this plan.")}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-3 border border-dashed border-[#2a2a2a] p-5">
              <p className="text-sm font-bold uppercase tracking-widest text-[#ccc]">No plans yet</p>
              <p className="text-sm text-[#888]">
                Plans are stored in this browser. Create one, import a plan file, or open a map below to look around
                first.
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="maps-heading" className="flex flex-col gap-3">
          <h2 id="maps-heading" className={eyebrow}>
            Browse a map
          </h2>
          <MapLinks />
        </section>
      </div>
    </div>
  );
}

function PlanRow({
  plan,
  onDuplicate,
  onExport,
  onDelete,
}: {
  plan: RaidPlan;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { gameMode } = useGameMode();
  const config = getMapConfig(plan.mapKey);
  const summary = [
    plural(plan.route.length, "waypoint"),
    plural(plan.drawings.length, "drawing"),
    plural(plan.notes.length, "note"),
  ].join(" · ");

  return (
    <li className="flex items-stretch border border-[#2a2a2a] bg-[#090909] transition-colors hover:border-[#3a3a3a]">
      <Link
        href={`/raid-planner/${plan.id}`}
        onPointerEnter={() => config && prefetchMap(config, gameMode)}
        onFocus={() => config && prefetchMap(config, gameMode)}
        onTouchStart={() => config && prefetchMap(config, gameMode)}
        className={cn("group flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-3 sm:px-4", focusRing)}
      >
        <span className="truncate text-sm font-bold text-[#ddd] group-hover:text-[#c9b88d]">
          {plan.name || "Untitled raid"}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-widest text-[#888]">
          <span className="flex items-center gap-1 text-[#9a8866]">
            <MapIcon className="h-3 w-3" aria-hidden />
            {config?.name ?? "Unknown map"}
          </span>
          <span className="max-sm:hidden">{summary}</span>
          <span>{dateFormat.format(plan.updatedAt)}</span>
        </span>
      </Link>
      <div className="flex shrink-0 items-center border-l border-[#1d1d1d]">
        <button
          type="button"
          title="Duplicate plan"
          onClick={onDuplicate}
          className={cn(
            "flex h-full min-h-12 w-12 items-center justify-center text-[#888] transition-colors hover:bg-[#141414] hover:text-[#ddd]",
            focusRing
          )}
        >
          <Copy className="h-4 w-4" aria-hidden />
          <span className="sr-only">Duplicate {plan.name}</span>
        </button>
        <button
          type="button"
          title="Download plan file"
          onClick={onExport}
          className={cn(
            "flex h-full min-h-12 w-12 items-center justify-center text-[#888] transition-colors hover:bg-[#141414] hover:text-[#ddd]",
            focusRing
          )}
        >
          <Download className="h-4 w-4" aria-hidden />
          <span className="sr-only">Download {plan.name} as a file</span>
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              title="Delete plan"
              className={cn(
                "flex h-full min-h-12 w-12 items-center justify-center text-[#888] transition-colors hover:bg-[#1a0e0e] hover:text-red-300",
                focusRing
              )}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Delete {plan.name}</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this plan?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-bold text-[#ccc]">{plan.name || "Untitled raid"}</span> will be permanently
                removed from this browser. Shared links keep working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
