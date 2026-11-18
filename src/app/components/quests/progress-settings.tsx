"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { GameMode } from "@/components/game-mode/mode";
import { MODE_LABEL } from "@/components/game-mode/mode";
import { MAX_PLAYER_LEVEL, resetQuestProgress, setFaction, setPlayerLevel } from "@/app/lib/quests/progress-store";
import { FACTIONS, type Faction, type QuestProgress } from "@/app/lib/quests/types";
import { plural } from "@/app/lib/seo/format";
import { Toggle } from "./quest-filters";
import { heading, panel } from "./quest-bits";

function saving(onError: (message: string) => void) {
  return (work: () => void) => {
    try {
      work();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not save your progress.");
    }
  };
}

/** The player's faction, saved as it changes. */
export function FactionToggles({
  gameMode,
  progress,
  disabled,
  onError,
}: {
  gameMode: GameMode;
  progress: QuestProgress;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const save = saving(onError);
  return (
    <div role="group" aria-label="Faction" className="flex gap-1.5">
      {[null, ...FACTIONS].map((faction: Faction | null) => (
        <Toggle
          key={faction ?? "any"}
          pressed={progress.faction === faction}
          disabled={disabled}
          onClick={() => save(() => setFaction(gameMode, faction))}
        >
          {faction ?? "Not set"}
        </Toggle>
      ))}
    </div>
  );
}

/** The player's level and faction, which decide what's available; saved as they change. */
export function LevelAndFaction({
  gameMode,
  progress,
  disabled,
  onError,
}: {
  gameMode: GameMode;
  progress: QuestProgress;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  // Typing goes through text so a half-typed level isn't saved; a whole one is.
  const [draft, setDraft] = useState<string | null>(null);
  const save = saving(onError);
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">Your level</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_PLAYER_LEVEL}
          disabled={disabled}
          placeholder="Not set"
          value={draft ?? progress.level ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw === "") return save(() => setPlayerLevel(gameMode, null));
            const level = Number(raw);
            if (Number.isInteger(level) && level >= 1 && level <= MAX_PLAYER_LEVEL) save(() => setPlayerLevel(gameMode, level));
          }}
          onBlur={() => setDraft(null)}
          className="h-10 w-28 border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-sm tabular-nums text-[#ddd] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9a8866]"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">Faction</span>
        <FactionToggles gameMode={gameMode} progress={progress} disabled={disabled} onError={onError} />
      </div>
    </div>
  );
}

export function ProgressSettings({
  gameMode,
  progress,
  total,
  hydrated,
  onError,
  onReset,
}: {
  gameMode: GameMode;
  progress: QuestProgress;
  total: number;
  hydrated: boolean;
  onError: (message: string) => void;
  onReset: () => void;
}) {
  const mode = MODE_LABEL[gameMode];
  return (
    <div className="flex flex-col gap-6">
      <section className={`${panel} flex flex-col gap-3 p-4`}>
        <h3 className={heading}>{mode} profile</h3>
        <p className="text-sm text-[#999]">
          Your level hides quests you can&apos;t take yet, and your faction hides the other faction&apos;s. Leave either unset to see
          everything.
        </p>
        <LevelAndFaction gameMode={gameMode} progress={progress} disabled={!hydrated} onError={onError} />
      </section>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ["Completed", hydrated ? `${progress.completed.length} / ${total}` : "—"],
          ["Objectives done", hydrated ? String(progress.objectives.length) : "—"],
        ].map(([label, value]) => (
          <div key={label} className={`${panel} flex flex-col gap-0.5 p-3`}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-[#777]">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-[#e6d9b8]">{value}</dd>
          </div>
        ))}
      </dl>
      <section className={`${panel} flex flex-col gap-3 p-4`}>
        <h3 className={heading}>Saved in this browser</h3>
        <p className="text-sm text-[#999]">
          Progress is kept for PVP and PVE separately, on this device only. To move it to another browser, use{" "}
          <Link href="/data" className="text-[#c8b384] underline underline-offset-2">
            backup and restore
          </Link>
          .
        </p>
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="w-fit" disabled={!hydrated || (progress.completed.length === 0 && progress.objectives.length === 0 && progress.level === null && progress.faction === null)}>
              <RotateCcw /> Reset {mode} progress
            </Button>
          }
          title={`Reset ${mode} quest progress?`}
          description={`This clears ${plural(progress.completed.length, "completed quest")}, ${plural(progress.objectives.length, "done objective")}, your level and your faction for ${mode}. ${gameMode === "regular" ? "PVE" : "PVP"} progress is kept. It can't be undone unless you have a backup.`}
          confirmLabel="Reset progress"
          onConfirm={() => {
            try {
              resetQuestProgress(gameMode);
              onReset();
            } catch (reason) {
              onError(reason instanceof Error ? reason.message : "Could not reset your progress.");
            }
          }}
        />
      </section>
    </div>
  );
}
