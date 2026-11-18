"use client";

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GameMode } from "@/components/game-mode/mode";
import { MODE_LABEL } from "@/components/game-mode/mode";
import { questStates } from "@/app/lib/quests/availability";
import { questName } from "@/app/lib/quests/display";
import { filterQuests, questMatches } from "@/app/lib/quests/filters";
import { questGraph } from "@/app/lib/quests/graph";
import { itemsNeeded, stillToDo } from "@/app/lib/quests/items-needed";
import {
  clearedFilters,
  parseQuestPageState,
  questFilter,
  questPageSearch,
  type QuestPageState,
  type QuestView,
} from "@/app/lib/quests/page-state";
import { useQuestProgress } from "@/app/lib/quests/progress-store";
import { primeQuestList, useQuestList } from "@/app/lib/quests/query";
import { shoppingList } from "@/app/lib/quests/shopping-list";
import type { QuestList } from "@/app/lib/quests/types";
import { plural } from "@/app/lib/seo/format";
import { cn } from "@/lib/utils";
import { ChainsView } from "./chains-view";
import { ItemsNeededView } from "./items-needed-view";
import { FactionToggles, LevelAndFaction, ProgressSettings } from "./progress-settings";
import { empty, panel } from "./quest-bits";
import { QuestFilters, Toggle } from "./quest-filters";
import { QuestRows } from "./quest-rows";
import { Notice, useQuestActions } from "./use-quest-actions";

const VIEWS: { id: QuestView; label: string }[] = [
  { id: "list", label: "All quests" },
  { id: "available", label: "Available now" },
  { id: "items", label: "Items needed" },
  { id: "chains", label: "Chains" },
  { id: "progress", label: "Progress" },
];

function ViewTabs({ active, onSelect }: { active: QuestView; onSelect: (view: QuestView) => void }) {
  return (
    <div role="group" aria-label="Quest view" className="flex max-w-full overflow-x-auto border border-[#1a1a1a]">
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={view.id === active}
          onClick={() => onSelect(view.id)}
          className={cn(
            "h-8 shrink-0 px-3 text-[11px] font-bold uppercase tracking-widest transition-colors",
            view.id === active ? "bg-[#c8b384] text-black" : "text-[#888] hover:bg-[#111] hover:text-[#ccc]"
          )}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

export interface QuestsInitial {
  gameMode: GameMode;
  list: QuestList;
  renderedAt: number;
}

export function QuestsPage({ initial, search }: { initial: QuestsInitial | null; search: Record<string, string | string[] | undefined> }) {
  useState(() => {
    if (initial && typeof window !== "undefined") primeQuestList(initial.gameMode, initial.list, initial.renderedAt);
    return null;
  });
  const query = useQuestList();
  const { gameMode, hydrated } = query;
  const list = query.list ?? (initial && (!hydrated || initial.gameMode === gameMode) ? initial.list : null);
  const progress = useQuestProgress(gameMode);
  const [state, setState] = useState<QuestPageState>(() => parseQuestPageState(search));
  const text = useDeferredValue(state.text);

  const graph = list ? questGraph(list.quests) : null;
  const statuses = useMemo(() => (graph && hydrated ? questStates(graph, progress) : null), [graph, hydrated, progress]);
  const actions = useQuestActions(gameMode, graph, progress);

  const change = (patch: Partial<QuestPageState>) => {
    const next = { ...state, ...patch };
    setState(next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${questPageSearch(next)}${window.location.hash}`);
  };
  const reportError = (message: string) => actions.setError(message);
  const nameOf = (id: string) => {
    const quest = graph?.byId.get(id);
    return quest ? questName(quest) : "another quest";
  };

  const filter = questFilter({ ...state, text }, statuses !== null);
  const factionSet = progress.faction !== null;

  let body: ReactNode;
  if (!list || !graph) {
    body = query.error ? (
      <div role="alert" className="flex items-center justify-between gap-3 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Quest data is temporarily unavailable.
        </span>
        <Button size="sm" variant="outline" onClick={query.retry}>
          Retry
        </Button>
      </div>
    ) : (
      <p className={empty}>Loading quests…</p>
    );
  } else if (state.view === "progress") {
    body = (
      <ProgressSettings
        gameMode={gameMode}
        progress={progress}
        total={list.quests.length}
        hydrated={hydrated}
        onError={reportError}
        onReset={actions.dismiss}
      />
    );
  } else if (state.view === "chains") {
    const trader = state.trader && list.traders.includes(state.trader) ? state.trader : list.traders[0];
    body = trader ? (
      <ChainsView
        graph={graph}
        traders={list.traders}
        trader={trader}
        layout={state.layout}
        statuses={statuses}
        onTrader={(next) => change({ trader: next })}
        onLayout={(layout) => change({ layout })}
      />
    ) : (
      <p className={empty}>No trader gives quests in this mode.</p>
    );
  } else if (state.view === "items") {
    // The search here narrows items, not quests; and every status but done and failed counts.
    const questOnly = { ...filter, text: undefined, states: undefined };
    const include = (quest: Parameters<typeof stillToDo>[0], status: Parameters<typeof stillToDo>[1]) =>
      stillToDo(quest, status) && (state.scope === "remaining" || status?.state === "available") && questMatches(quest, questOnly, list, status);
    const counted = list.quests.filter((quest) => include(quest, statuses?.get(quest.id))).length;
    const shopping = shoppingList(itemsNeeded(graph, progress, include, statuses ?? new Map()));
    body = (
      <div className="flex flex-col gap-4">
        <QuestFilters
          state={state}
          list={list}
          hydrated={hydrated}
          factionSet={factionSet}
          onChange={change}
          onClear={() => change(clearedFilters(state))}
          showStatus={false}
          textLabel="Search items"
        />
        <div role="group" aria-label="Which quests" className="flex flex-wrap gap-1.5">
          <Toggle pressed={state.scope === "remaining"} onClick={() => change({ scope: "remaining" })}>
            Every quest left
          </Toggle>
          <Toggle pressed={state.scope === "available"} disabled={!hydrated} onClick={() => change({ scope: "available" })}>
            Available now
          </Toggle>
        </div>
        {hydrated && shopping.factionVersions && (
          <section className={`${panel} flex flex-wrap items-center justify-between gap-3 p-3`}>
            <p className="text-xs text-[#bbb]">
              Your faction isn&apos;t set, so quests with a USEC and a BEAR version count once, at the larger need. Set it to count only yours.
            </p>
            <FactionToggles gameMode={gameMode} progress={progress} disabled={!hydrated} onError={reportError} />
          </section>
        )}
        <ItemsNeededView
          shopping={shopping}
          list={list}
          graph={graph}
          text={text}
          questCount={counted}
        />
      </div>
    );
  } else {
    const available = state.view === "available";
    const quests = filterQuests(list, available ? { ...filter, states: ["available"] } : filter, statuses ?? undefined);
    const unset = progress.level === null || progress.faction === null;
    body = (
      <div className="flex flex-col gap-4">
        {available && hydrated && unset && (
          <section className={`${panel} flex flex-col gap-3 p-4`}>
            <p className="text-sm text-[#bbb]">
              Set your level and faction so this only shows quests you can take. Mark the quests you&apos;ve done in the list or the
              chains: completing one marks the quests before it too.
            </p>
            <LevelAndFaction gameMode={gameMode} progress={progress} disabled={!hydrated} onError={reportError} />
          </section>
        )}
        <QuestFilters
          state={state}
          list={list}
          hydrated={hydrated}
          factionSet={factionSet}
          onChange={change}
          onClear={() => change(clearedFilters(state))}
          showStatus={!available}
        />
        {available && !statuses ? (
          <p className={empty}>Loading your progress…</p>
        ) : quests.length === 0 ? (
          <p className={empty}>
            {available ? "Nothing matches: no quest you can take now fits these filters." : "No quest matches these filters."}
          </p>
        ) : (
          <>
            <p className="text-xs text-[#888]">
              {plural(quests.length, "quest")}
              {available && " you can take now. Trader loyalty levels and talking to traders aren't tracked: check those in game."}
            </p>
            <QuestRows
              quests={quests}
              list={list}
              statuses={statuses}
              onToggle={(quest) => actions.toggle(quest.id, questName(quest))}
              disabled={!hydrated}
              nameOf={nameOf}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs active={state.view} onSelect={(view) => change({ view })} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">
          {hydrated ? `${MODE_LABEL[gameMode]} progress` : " "}
          {hydrated && list && ` · ${progress.completed.length} done`}
        </span>
      </div>
      {query.stale && list && (
        <p role="status" className="border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Showing saved quest data while fresh data loads.
        </p>
      )}
      <Notice notice={actions.notice} onDismiss={actions.dismiss} />
      {body}
      {actions.dialog}
    </div>
  );
}
