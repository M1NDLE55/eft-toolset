"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { MAX_PLAYER_LEVEL } from "@/app/lib/quests/progress-store";
import { QUEST_STATES, activeFilterCount, type QuestPageState } from "@/app/lib/quests/page-state";
import type { QuestList } from "@/app/lib/quests/types";
import { cn } from "@/lib/utils";
import { STATE_LABEL } from "./quest-bits";

const field =
  "h-10 w-full min-w-0 border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-sm text-[#ddd] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9a8866]";

export function Toggle({
  pressed,
  onClick,
  children,
  disabled,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 border px-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-[#9a8866] disabled:opacity-40",
        pressed ? "border-[#9a8866] bg-[#1a1712] text-[#e6d9b8]" : "border-[#2a2a2a] text-[#888] hover:text-[#ccc]"
      )}
    >
      {children}
    </button>
  );
}

function LevelField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_PLAYER_LEVEL}
        value={value ?? ""}
        placeholder="Any"
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChange(null);
          const number = Number(raw);
          if (Number.isInteger(number) && number >= 1 && number <= MAX_PLAYER_LEVEL) onChange(number);
        }}
        className={field}
      />
    </label>
  );
}

/** Map choices by page: variants (night Factory) fold onto the map they share a page with. */
export function mapChoices(list: QuestList) {
  const choices = new Map<string, string>();
  for (const map of Object.values(list.maps)) {
    const key = map.page ?? map.key;
    if (!choices.has(key) || map.key === key) choices.set(key, map.name);
  }
  return Array.from(choices, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function QuestFilters({
  state,
  list,
  hydrated,
  factionSet,
  onChange,
  onClear,
  showStatus = true,
  textLabel = "Search quests, traders or items",
}: {
  state: QuestPageState;
  list: QuestList | null;
  hydrated: boolean;
  factionSet: boolean;
  onChange: (patch: Partial<QuestPageState>) => void;
  onClear: () => void;
  showStatus?: boolean;
  textLabel?: string;
}) {
  const traders = list?.traders ?? [];
  const maps = list ? mapChoices(list) : [];
  const anyLightkeeper = list?.quests.some((quest) => quest.lightkeeperRequired) ?? false;
  const active = activeFilterCount(state);
  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <span className="sr-only">{textLabel}</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" />
        <input
          type="search"
          value={state.text}
          maxLength={100}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder={textLabel}
          className={cn(field, "pl-9")}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">Trader</span>
          <select value={state.trader ?? ""} onChange={(event) => onChange({ trader: event.target.value || null })} className={field}>
            <option value="">Any trader</option>
            {traders.map((trader) => (
              <option key={trader} value={trader}>
                {trader}
              </option>
            ))}
            {state.trader && !traders.includes(state.trader) && <option value={state.trader}>{state.trader}</option>}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">Map</span>
          <select value={state.map ?? ""} onChange={(event) => onChange({ map: event.target.value || null })} className={field}>
            <option value="">Any map</option>
            {maps.map((map) => (
              <option key={map.key} value={map.key}>
                {map.name}
              </option>
            ))}
            {state.map && !maps.some((map) => map.key === state.map) && <option value={state.map}>{state.map}</option>}
          </select>
        </label>
        <LevelField label="From level" value={state.minLevel} onChange={(minLevel) => onChange({ minLevel })} />
        <LevelField label="To level" value={state.maxLevel} onChange={(maxLevel) => onChange({ maxLevel })} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle pressed={state.kappa} onClick={() => onChange({ kappa: !state.kappa })} title="Quests needed for the Kappa container">
          Kappa
        </Toggle>
        {(anyLightkeeper || state.lightkeeper) && (
          <Toggle pressed={state.lightkeeper} onClick={() => onChange({ lightkeeper: !state.lightkeeper })} title="Quests needed for Lightkeeper">
            Lightkeeper
          </Toggle>
        )}
        <Toggle pressed={state.fir} onClick={() => onChange({ fir: !state.fir })} title="Quests that need items found in raid">
          FIR items
        </Toggle>
        <Toggle
          pressed={state.ownFaction}
          // Left on from a link without a faction set, it can still be turned off.
          disabled={hydrated && !factionSet && !state.ownFaction}
          onClick={() => onChange({ ownFaction: !state.ownFaction })}
          title={factionSet ? "Hide the other faction's quests" : "Set your faction in Progress first"}
        >
          My faction
        </Toggle>
        {showStatus && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px bg-[#2a2a2a]" />
            {QUEST_STATES.map((entry) => (
              <Toggle
                key={entry}
                pressed={state.states.includes(entry)}
                onClick={() =>
                  onChange({ states: state.states.includes(entry) ? state.states.filter((other) => other !== entry) : [...state.states, entry] })
                }
              >
                {STATE_LABEL[entry]}
              </Toggle>
            ))}
          </>
        )}
        {active > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto h-9 px-2 text-[10px] font-bold uppercase tracking-widest text-[#c8b384] underline-offset-2 hover:underline"
          >
            Clear filters ({active})
          </button>
        )}
      </div>
    </div>
  );
}
