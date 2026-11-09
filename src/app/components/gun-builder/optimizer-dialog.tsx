"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, Sparkles } from "lucide-react";
import type { AmmoItemData, BuildNode, GunBuild, PriceSources } from "@/app/lib/types/gunBuilder";
import type { GameMode } from "@/components/game-mode/context";
import { optimizeBuild, type OptimizeGoal } from "@/app/lib/builds/optimizer";
import { computeStats, type ItemLookup } from "@/app/lib/builds/stats";
import { diffBuildTrees, statDeltas, type SlotDiffRow, type StatDelta } from "@/app/lib/builds/compare";
import { collectItemIds } from "@/app/lib/builds/tree";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import { getGunItemState, loadCompatibilityGraph } from "@/app/lib/cache/gunBuilder";
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
import { cn } from "@/lib/utils";
import { formatRub } from "./format";
import { StatDeltaTable } from "./stat-deltas";
import { DiffList } from "./diff-list";

const GOALS: { key: OptimizeGoal; label: string; hint: string }[] = [
  { key: "ergonomics", label: "Ergonomics", hint: "Highest ergo" },
  { key: "recoil", label: "Recoil", hint: "Lowest vertical recoil" },
  { key: "cost", label: "Cost", hint: "Cheapest parts" },
];

const MAX_BUDGET = 1_000_000_000;

type Phase =
  | { status: "idle" }
  | { status: "loading"; loaded: number }
  | { status: "solving"; step: number }
  | {
      status: "done";
      base: BuildNode;
      root: BuildNode;
      lookup: ItemLookup;
      deltas: StatDelta[];
      changes: SlotDiffRow[];
      changed: boolean;
      withinBudget: boolean;
      conflicts: number;
      missingRequired: number;
      truncated: boolean;
      goal: OptimizeGoal;
    }
  | { status: "error"; message: string };

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 border border-[#1a1a1a] bg-[#080808] px-3 py-2.5 text-left transition-colors hover:border-[#3a3326] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] disabled:opacity-40"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-7 shrink-0 items-center border p-0.5 transition-colors",
          checked ? "justify-end border-[#9a8866] bg-[#9a8866]/20" : "justify-start border-[#3a3a3a]"
        )}
      >
        <span className={cn("h-2.5 w-2.5", checked ? "bg-[#e6d9b8]" : "bg-[#555]")} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-widest text-[#ccc]">{label}</span>
        <span className="block text-xs text-[#777]">{hint}</span>
      </span>
    </button>
  );
}

export function OptimizerDialog({
  build,
  gameMode,
  priceSources,
  currentCost,
  ammo,
  disabled,
  onApply,
}: {
  build: GunBuild;
  gameMode: GameMode;
  priceSources: PriceSources;
  currentCost: number | null;
  ammo: AmmoItemData | null;
  disabled: boolean;
  onApply: (root: BuildNode, base: BuildNode, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState<OptimizeGoal>("ergonomics");
  const [budgetText, setBudgetText] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [allowUnpriced, setAllowUnpriced] = useState(false);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (phase.status === "done") previewRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [phase.status]);

  const budget = budgetText ? Math.min(MAX_BUDGET, Number(budgetText)) : null;
  const noSources = !priceSources.traders && !priceSources.flea;
  const blocked = noSources && (goal === "cost" || !allowUnpriced);
  const running = phase.status === "loading" || phase.status === "solving";
  const stale = phase.status === "done" && phase.base !== build.root;

  function reset() {
    controller.current?.abort();
    controller.current = null;
    setPhase({ status: "idle" });
  }

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      if (phase.status !== "idle") reset();
    };
  }

  async function run() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const base = build.root;
    setPhase({ status: "loading", loaded: 0 });
    try {
      const graph = await loadCompatibilityGraph(collectItemIds(base), gameMode, {
        signal: active.signal,
        onProgress: (loaded) => setPhase({ status: "loading", loaded }),
      });
      setPhase({ status: "solving", step: 0 });
      const lookup = getGunItemState(gameMode).items;
      const result = await optimizeBuild(
        base,
        lookup,
        {
          goal,
          priceSources,
          budget: goal === "cost" ? null : budget,
          replaceExisting,
          allowUnpriced,
          ammoId: build.ammoId ?? null,
        },
        {
          signal: active.signal,
          onProgress: (step) => {
            if (step % 8 === 0) setPhase({ status: "solving", step });
          },
        }
      );
      if (active.signal.aborted) return;
      const ammoFor = (root: BuildNode) =>
        ammo && ammoFits(ammo.id, ammoOptions(root, lookup)) ? ammo : null;
      const before = computeStats(base, lookup, priceSources, ammoFor(base));
      const after = computeStats(result.root, lookup, priceSources, ammoFor(result.root));
      setPhase({
        status: "done",
        base,
        root: result.root,
        lookup,
        deltas: statDeltas(before, after),
        changes: diffBuildTrees(base, result.root, lookup).filter((row) => row.status !== "same"),
        changed: result.changed,
        withinBudget: result.withinBudget,
        conflicts: result.conflicts,
        missingRequired: after.missingRequired.length,
        truncated: graph.truncated,
        goal,
      });
    } catch (reason) {
      if (active.signal.aborted) return;
      setPhase({
        status: "error",
        message: reason instanceof Error ? reason.message : "The optimiser could not finish.",
      });
    } finally {
      if (controller.current === active) controller.current = null;
    }
  }

  function apply() {
    if (phase.status !== "done" || stale) return;
    const label = GOALS.find((entry) => entry.key === phase.goal)?.label.toLowerCase() ?? "stats";
    onApply(phase.root, phase.base, `Optimised for ${label}`);
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} aria-label="Optimise build">
          <Sparkles />
          <span className="max-lg:sr-only">Optimise</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(90dvh,820px)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-[#1a1a1a] p-4 pr-10 text-left sm:p-5 sm:pr-12">
          <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">
            Optimise build
          </DialogTitle>
          <DialogDescription>
            Searches every compatible part for this weapon. Occupied and required slots stay filled. Preview the result before applying.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#888]">Optimise for</legend>
            <div role="radiogroup" aria-label="Optimise for" className="grid grid-cols-3 border border-[#2a2a2a]">
              {GOALS.map((option) => {
                const active = goal === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => change(setGoal)(option.key)}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 border-l border-[#2a2a2a] px-2 py-2 first:border-l-0 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8]",
                      active ? "bg-[#9a8866] text-[#070707]" : "text-[#aaa] hover:bg-[#121212] hover:text-[#e6d9b8]"
                    )}
                  >
                    <span className="text-[11px] font-black uppercase tracking-widest">{option.label}</span>
                    <span className={cn("text-[10px] leading-tight", active ? "text-[#070707]/80" : "text-[#666]")}>{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="optimizer-budget" className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
              Max build cost <span className="normal-case tracking-normal text-[#666]">(optional, includes the weapon)</span>
            </label>
            <div className="relative">
              <Input
                id="optimizer-budget"
                inputMode="numeric"
                autoComplete="off"
                value={budgetText}
                disabled={goal === "cost"}
                onChange={(event) => change(setBudgetText)(event.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder={goal === "cost" ? "Not used when optimising cost" : "No limit"}
                className="pr-10 tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#666]">₽</span>
            </div>
            <p className="text-xs text-[#666]">
              {budget !== null && goal !== "cost" ? `${formatRub(budget)} · ` : ""}
              Current build {formatRub(currentCost)}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle
              checked={replaceExisting}
              onChange={change(setReplaceExisting)}
              label="Replace installed parts"
              hint={replaceExisting ? "Installed parts can be swapped." : "Keeps every installed part and only fills empty slots."}
            />
            <Toggle
              checked={allowUnpriced && goal !== "cost"}
              disabled={goal === "cost"}
              onChange={change(setAllowUnpriced)}
              label="Include unpriced parts"
              hint="Barter or quest-only parts with no price from your selected sources."
            />
          </div>

          {blocked && (
            <p className="flex items-center gap-2 border border-[#3a3020] bg-[#0e0b07] px-3 py-2 text-xs text-[#c8b384]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Turn on trader or flea prices in the stats panel{goal === "cost" ? "" : ", or include unpriced parts"}.
            </p>
          )}

          {running && (
            <div aria-live="polite" className="flex items-center gap-3 border border-[#1a1a1a] bg-[#080808] px-3 py-3 text-sm text-[#ccc]">
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[#9a8866]" />
              {phase.status === "loading"
                ? `Loading compatible parts${phase.loaded ? ` · ${phase.loaded}` : ""}`
                : `Searching combinations${phase.step ? ` · ${phase.step} passes` : ""}`}
            </div>
          )}

          {phase.status === "error" && (
            <p role="alert" className="flex items-center gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {phase.message}
            </p>
          )}

          {phase.status === "done" && (
            <section ref={previewRef} aria-label="Optimised preview" className="flex scroll-mt-4 flex-col gap-3">
              {!phase.changed ? (
                <p className="flex items-center gap-2 border border-[#1a1a1a] bg-[#080808] px-3 py-3 text-sm text-[#ccc]">
                  <Check className="h-4 w-4 shrink-0 text-[#9a8866]" />
                  This build is already the best match for these settings.
                </p>
              ) : (
                <>
                  {(!phase.withinBudget || phase.conflicts > 0 || phase.missingRequired > 0 || phase.truncated || stale) && (
                    <ul className="flex flex-col gap-1 border border-[#3a3020] bg-[#0e0b07] px-3 py-2 text-xs text-[#c8b384]">
                      {stale && <li>The build changed since this preview. Run the optimiser again.</li>}
                      {!phase.withinBudget && <li>No combination fits the budget. Showing the cheapest build found.</li>}
                      {phase.conflicts > 0 && <li>{phase.conflicts} part conflict{phase.conflicts === 1 ? "" : "s"} could not be resolved.</li>}
                      {phase.missingRequired > 0 && (
                        <li>{phase.missingRequired} required slot{phase.missingRequired === 1 ? "" : "s"} have no usable part.</li>
                      )}
                      {phase.truncated && <li>This weapon has too many compatible parts; some were not considered.</li>}
                    </ul>
                  )}
                  <StatDeltaTable rows={phase.deltas} leftLabel="Current" rightLabel="Optimised" />
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
                    {phase.changes.length} change{phase.changes.length === 1 ? "" : "s"}
                  </h3>
                  <DiffList rows={phase.changes} lookup={phase.lookup} leftLabel="Current" rightLabel="Optimised" />
                </>
              )}
            </section>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#1a1a1a] p-4 sm:flex-row sm:justify-end sm:p-5">
          {running ? (
            <Button variant="outline" onClick={reset}>
              Cancel
            </Button>
          ) : phase.status === "done" && phase.changed && !stale ? (
            <>
              <Button variant="outline" onClick={() => void run()}>
                Run again
              </Button>
              <Button onClick={apply}>
                <Check /> Apply changes
              </Button>
            </>
          ) : (
            <Button onClick={() => void run()} disabled={blocked}>
              <Sparkles /> {phase.status === "done" || phase.status === "error" ? "Run again" : "Find best parts"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
