"use client";

import Link from "next/link";
import type { QuestState, QuestStatus } from "@/app/lib/quests/availability";
import { CHAIN_NODE, layoutChain, type ChainEdgeKind, type ChainLayout } from "@/app/lib/quests/chain-layout";
import { questName, sameNameHints } from "@/app/lib/quests/display";
import { traderChain, type QuestGraph } from "@/app/lib/quests/graph";
import type { QuestMap } from "@/app/lib/quests/types";
import { cn } from "@/lib/utils";
import { Toggle } from "./quest-filters";
import { STATE_LABEL, heading, panel } from "./quest-bits";

const NODE_TONE: Record<QuestState | "unknown", string> = {
  completed: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
  available: "border-[#9a8866] bg-[#1a1610] text-[#e6d9b8]",
  locked: "border-[#2a2a2a] bg-[#0f0f0f] text-[#999]",
  failed: "border-red-900/70 bg-red-950/30 text-red-300 line-through",
  unknown: "border-[#2a2a2a] bg-[#0f0f0f] text-[#ccc]",
};

const EDGE_STYLE: Record<ChainEdgeKind, { stroke: string; dash?: string }> = {
  complete: { stroke: "#4a4234" },
  active: { stroke: "#7a6a48", dash: "2 4" },
  failed: { stroke: "#7f1d1d", dash: "6 4" },
};

function traderNames(ids: string[], graph: QuestGraph) {
  return Array.from(new Set(ids.map((id) => graph.byId.get(id)?.trader).filter((name): name is string => Boolean(name))));
}

function externalTitle(label: string, ids: string[], graph: QuestGraph) {
  return `${label}: ${ids.map((id) => {
    const quest = graph.byId.get(id);
    return quest ? `${questName(quest)} (${quest.trader})` : "another quest";
  }).join(", ")}`;
}

function ExternalNote({ layout, id, graph }: { layout: ChainLayout; id: string; graph: QuestGraph }) {
  const external = layout.external.get(id);
  if (!external) return null;
  return (
    <>
      {external.needs.length > 0 && (
        <span title={externalTitle("Also needs", external.needs, graph)} className="truncate text-[#b9a473]">
          ← {traderNames(external.needs, graph).join(", ")}
        </span>
      )}
      {external.unlocks.length > 0 && (
        <span title={externalTitle("Leads to", external.unlocks, graph)} className="truncate text-[#b9a473]">
          → {traderNames(external.unlocks, graph).join(", ")}
        </span>
      )}
    </>
  );
}

type Hints = ReadonlyMap<string, string>;

function Tree({ layout, graph, statuses, hints }: { layout: ChainLayout; graph: QuestGraph; statuses: ReadonlyMap<string, QuestStatus> | null; hints: Hints }) {
  const pad = 12;
  return (
    <div role="region" className={cn(panel, "max-h-[75vh] overflow-auto overscroll-contain")} tabIndex={0} aria-label="Quest chain, scrolls both ways">
      <div className="relative" style={{ width: layout.width + pad * 2, height: layout.height + pad * 2 }}>
        <svg aria-hidden className="absolute inset-0" width={layout.width + pad * 2} height={layout.height + pad * 2}>
          <g transform={`translate(${pad} ${pad})`} fill="none" strokeWidth={1.5}>
            {layout.chains.slice(1).map((chain) => (
              <line
                key={chain.top}
                x1={0}
                x2={layout.width}
                y1={chain.top - CHAIN_NODE.chainGap / 2}
                y2={chain.top - CHAIN_NODE.chainGap / 2}
                stroke="#1f1f1f"
                strokeWidth={1}
              />
            ))}
            {layout.paths.map((path) => (
              <path key={`${path.from}-${path.to}`} d={path.d} stroke={EDGE_STYLE[path.kind].stroke} strokeDasharray={EDGE_STYLE[path.kind].dash} />
            ))}
          </g>
        </svg>
        {layout.nodes.map((node) => {
          const quest = graph.byId.get(node.id);
          if (!quest) return null;
          const state = statuses?.get(node.id)?.state ?? "unknown";
          const name = questName(quest);
          const hint = hints.get(node.id);
          const className = cn(
            "absolute flex flex-col justify-center gap-0.5 overflow-hidden border px-2 text-[11px] leading-tight transition-colors hover:border-[#c8b384]",
            NODE_TONE[state]
          );
          const style = { left: node.x + pad, top: node.y + pad, width: CHAIN_NODE.width, height: CHAIN_NODE.height };
          const body = (
            <>
              <span className="truncate font-semibold">
                {name}
                {state !== "unknown" && <span className="sr-only"> ({STATE_LABEL[state]})</span>}
              </span>
              <span className="flex gap-2 text-[10px] text-[#777] no-underline">
                {hints.has(node.id) && <span className="truncate">{hints.get(node.id)}</span>}
                {quest.minPlayerLevel > 1 && <span className="shrink-0">Lv {quest.minPlayerLevel}</span>}
                {quest.faction && <span className="shrink-0">{quest.faction}</span>}
                <ExternalNote layout={layout} id={node.id} graph={graph} />
              </span>
            </>
          );
          return quest.slug ? (
            <Link key={node.id} href={`/quests/${quest.slug}`} title={hint ? `${name} (${hint})` : name} className={className} style={style}>
              {body}
            </Link>
          ) : (
            <span key={node.id} title={hint ? `${name} (${hint})` : name} className={className} style={style}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Steps({ layout, graph, statuses, hints }: { layout: ChainLayout; graph: QuestGraph; statuses: ReadonlyMap<string, QuestStatus> | null; hints: Hints }) {
  const parents = new Map<string, { id: string; kind: ChainEdgeKind }[]>();
  for (const path of layout.paths) parents.set(path.to, [...(parents.get(path.to) ?? []), { id: path.from, kind: path.kind }]);
  return (
    <ol className="flex flex-col gap-4">
      {layout.columns.map((column, index) => (
        <li key={index} className="flex flex-col gap-2">
          <h3 className={heading}>{index === 0 ? "Start" : `Step ${index + 1}`}</h3>
          <ul className={`${panel} divide-y divide-[#151515]`}>
            {column.map((id) => {
              const quest = graph.byId.get(id);
              if (!quest) return null;
              const state = statuses?.get(id)?.state ?? "unknown";
              const after = parents.get(id) ?? [];
              return (
                <li key={id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 border", NODE_TONE[state])} />
                    {quest.slug ? (
                      <Link href={`/quests/${quest.slug}`} className="font-semibold text-[#ddd] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                        {questName(quest)}
                      </Link>
                    ) : (
                      <span className="font-semibold text-[#ddd]">{questName(quest)}</span>
                    )}
                    {state !== "unknown" && <span className="sr-only">({STATE_LABEL[state]})</span>}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-[11px] text-[#777]">
                    {hints.has(id) && <span>{hints.get(id)}</span>}
                    {quest.minPlayerLevel > 1 && <span>Level {quest.minPlayerLevel}</span>}
                    {after.length > 0 && (
                      <span>
                        After{" "}
                        {after
                          .map((entry) => {
                            const other = graph.byId.get(entry.id);
                            const name = other ? questName(other) : "another quest";
                            return entry.kind === "failed" ? `failing ${name}` : entry.kind === "active" ? `starting ${name}` : name;
                          })
                          .join(", ")}
                      </span>
                    )}
                    <ExternalNote layout={layout} id={id} graph={graph} />
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** The trader's quests with no link to their others, as a compact grid under the chains. */
function Standalone({ layout, graph, statuses, hints }: { layout: ChainLayout; graph: QuestGraph; statuses: ReadonlyMap<string, QuestStatus> | null; hints: Hints }) {
  if (layout.standalone.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className={heading}>
        Standalone quests <span className="text-[#666]">· {layout.standalone.length}</span>
      </h3>
      <p className="-mt-1 text-xs text-[#777]">No other quest from this trader comes before or after these.</p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {layout.standalone.map((id) => {
          const quest = graph.byId.get(id);
          if (!quest) return null;
          const state = statuses?.get(id)?.state ?? "unknown";
          const name = questName(quest);
          return (
            <li key={id} className={cn("flex min-w-0 items-center gap-2 border px-2 py-1.5 text-xs", NODE_TONE[state])}>
              {quest.slug ? (
                <Link href={`/quests/${quest.slug}`} title={name} className="min-w-0 truncate font-semibold underline-offset-2 hover:underline">
                  {name}
                </Link>
              ) : (
                <span title={name} className="min-w-0 truncate font-semibold">
                  {name}
                </span>
              )}
              {state !== "unknown" && <span className="sr-only">({STATE_LABEL[state]})</span>}
              <span className="ml-auto flex shrink-0 gap-2 text-[10px] text-[#777] no-underline">
                {hints.has(id) && <span>{hints.get(id)}</span>}
                {quest.minPlayerLevel > 1 && <span>Lv {quest.minPlayerLevel}</span>}
                {quest.faction && <span>{quest.faction}</span>}
                <ExternalNote layout={layout} id={id} graph={graph} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Legend() {
  const swatch = (state: QuestState) => <span aria-hidden className={cn("h-2.5 w-2.5 border", NODE_TONE[state])} />;
  const line = (kind: ChainEdgeKind) => (
    <svg aria-hidden width="24" height="6">
      <line x1="0" y1="3" x2="24" y2="3" stroke={EDGE_STYLE[kind].stroke} strokeDasharray={EDGE_STYLE[kind].dash} strokeWidth={2} />
    </svg>
  );
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#888]">
      <li className="flex items-center gap-1.5">{swatch("completed")} Done</li>
      <li className="flex items-center gap-1.5">{swatch("available")} Available</li>
      <li className="flex items-center gap-1.5">{swatch("locked")} Locked</li>
      <li className="flex items-center gap-1.5">{swatch("failed")} Failed</li>
      <li className="flex items-center gap-1.5">{line("complete")} Complete first</li>
      <li className="flex items-center gap-1.5">{line("active")} Start first</li>
      <li className="flex items-center gap-1.5">{line("failed")} Failure branch</li>
      <li className="flex items-center gap-1.5">
        <span className="text-[#b9a473]">← →</span> Other traders
      </li>
    </ul>
  );
}

export function ChainsView({
  graph,
  maps,
  traders,
  trader,
  layout: mode,
  statuses,
  onTrader,
  onLayout,
}: {
  graph: QuestGraph;
  maps: Readonly<Record<string, QuestMap>>;
  traders: string[];
  trader: string;
  layout: "tree" | "steps";
  statuses: ReadonlyMap<string, QuestStatus> | null;
  onTrader: (trader: string) => void;
  onLayout: (layout: "tree" | "steps") => void;
}) {
  const layout = layoutChain(graph, traderChain(graph, trader));
  const hints = sameNameHints(graph, maps);
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Trader" className="flex flex-wrap gap-1.5">
        {traders.map((entry) => (
          <Toggle key={entry} pressed={entry === trader} onClick={() => onTrader(entry)}>
            {entry}
          </Toggle>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <div role="group" aria-label="Chain layout" className="flex gap-1.5">
          <Toggle pressed={mode === "tree"} onClick={() => onLayout("tree")}>
            Tree
          </Toggle>
          <Toggle pressed={mode === "steps"} onClick={() => onLayout("steps")}>
            Steps
          </Toggle>
        </div>
      </div>
      {layout.nodes.length === 0 && layout.standalone.length === 0 ? (
        <p className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">{trader} gives no quests in this mode.</p>
      ) : (
        <>
          {layout.nodes.length > 0 &&
            (mode === "tree" ? (
              <>
                <p className="text-xs text-[#777]">
                  Each block is one chain, and each column follows the one before it. Scroll the chart sideways on a narrow screen, or switch to
                  steps.
                </p>
                <Tree layout={layout} graph={graph} statuses={statuses} hints={hints} />
              </>
            ) : (
              <Steps layout={layout} graph={graph} statuses={statuses} hints={hints} />
            ))}
          <Standalone layout={layout} graph={graph} statuses={statuses} hints={hints} />
        </>
      )}
    </div>
  );
}
