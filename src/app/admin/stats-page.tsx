"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Metadata } from "@/app/lib/seo/metadata";
import type { DashboardStats, Distribution, Ranked } from "@/app/lib/usage/stats";
import { cn } from "@/lib/utils";

export const ADMIN_STATS_METADATA: Metadata = {
  title: "Usage stats",
  robots: { index: false, follow: false },
};

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

type State =
  | { kind: "loading" }
  | { kind: "ready"; stats: DashboardStats }
  | { kind: "signed_out" }
  | { kind: "denied"; message: string }
  | { kind: "error"; message: string };

// Series colours: validated as a set against the dark surface (dataviz validator: CVD and contrast pass).
const SERIES = { web: "#3987e5", mcp: "#d95926", server: "#199e70" } as const;
const SERIES_LABEL = { web: "Website", mcp: "AI agents (MCP)", server: "Server" } as const;
const BAR = "#9a8866";

async function loadStats(range: Range): Promise<State> {
  try {
    const response = await fetch(`/api/admin/stats?days=${range}`, { cache: "no-store" });
    const body = (await response.json()) as DashboardStats & { error?: string };
    if (response.status === 401) return { kind: "signed_out" };
    if (response.status === 403 || response.status === 404) return { kind: "denied", message: body.error ?? "Not found." };
    if (!response.ok) return { kind: "error", message: body.error ?? "The stats couldn't be read." };
    return { kind: "ready", stats: body };
  } catch {
    return { kind: "error", message: "The stats couldn't be read." };
  }
}

const formatNumber = (value: number) => Math.round(value).toLocaleString("en-GB");

export function AdminStatsPage() {
  const [range, setRange] = useState<Range>(7);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadStats(range).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <main className="flex flex-1 justify-center p-4 pb-12">
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3 pt-6">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Usage stats</h1>
            <p className="text-xs text-[#888]">Anonymous events from the website and AI agents. Admins only.</p>
          </div>
          <div role="group" aria-label="Time range" className="flex gap-1">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={range === option}
                onClick={() => {
                  setState({ kind: "loading" });
                  setRange(option);
                }}
                className={cn(
                  "border px-3 py-1.5 text-xs font-bold uppercase tracking-widest",
                  range === option ? "border-[#9a8866] bg-[#9a8866] text-black" : "border-[#333] text-[#bbb] hover:border-[#9a8866]"
                )}
              >
                {option} days
              </button>
            ))}
          </div>
        </header>
        <Body state={state} />
      </div>
    </main>
  );
}

function Body({ state }: { state: State }) {
  if (state.kind === "loading") return <p className="text-sm text-[#888]">Loading…</p>;
  if (state.kind === "signed_out") {
    return (
      <p className="text-sm text-[#bbb]">
        Sign in with an admin account to see the stats.{" "}
        <a href="/auth/sign-in" className="text-[#9a8866] underline underline-offset-2">
          Sign in
        </a>
      </p>
    );
  }
  if (state.kind === "denied" || state.kind === "error") return <p className="text-sm text-[#e66767]">{state.message}</p>;
  const { stats } = state;
  const lastDay = stats.dailyActive.at(-1);
  const lastWeek = stats.weeklyActive.at(-1);
  return (
    <>
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Events" value={stats.totals.events} />
        <Tile label="Website events" value={stats.totals.web} />
        <Tile label="MCP tool calls" value={stats.totals.mcp} />
        <Tile label="Accounts" value={stats.accounts?.total ?? null} note={stats.accounts?.capped ? "at least" : undefined} />
        <Tile label="Visitors (latest day)" value={lastDay?.visitors ?? 0} />
        <Tile label="Active accounts (latest day)" value={lastDay?.accounts ?? 0} />
        <Tile label="Visitors (latest week)" value={lastWeek?.visitors ?? 0} />
        <Tile label="Active accounts (latest week)" value={lastWeek?.accounts ?? 0} />
      </section>

      <Panel title="Events per day, website vs AI agents">
        <StackedDays rows={stats.daily} />
      </Panel>

      <Panel title="Daily unique visitors and active accounts">
        <ActiveLines rows={stats.dailyActive.map(({ day, visitors, accounts }) => ({ period: day, visitors, accounts }))} />
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Weekly unique visitors and active accounts">
          <SimpleTable
            head={["Week from", "Visitors", "Accounts"]}
            rows={stats.weeklyActive.map((row) => [row.week, formatNumber(row.visitors), formatNumber(row.accounts)])}
          />
        </Panel>
        <Panel title="Actions per active id per day">
          <DistributionTable rows={stats.actionsPerId} />
        </Panel>
        <Panel title="Features">
          <RankedBars rows={stats.features} />
        </Panel>
        <Panel title="MCP tools">
          <RankedBars rows={stats.tools} showErrors />
        </Panel>
        <Panel title="Weapons">
          <RankedBars rows={stats.weapons} />
        </Panel>
        <Panel title="Maps">
          <RankedBars rows={stats.maps} />
        </Panel>
        <Panel title="Items">
          <RankedBars rows={stats.items} />
        </Panel>
        <Panel title="Pages">
          <RankedBars rows={stats.pages} />
        </Panel>
        <Panel title="Events">
          <RankedBars rows={stats.events} showErrors />
        </Panel>
        <Panel title="Page errors">
          <RankedBars rows={stats.pageErrors} />
        </Panel>
        <Panel title="Page errors by kind">
          <RankedBars rows={stats.pageErrorKinds} />
        </Panel>
        <Panel title="Countries">
          <RankedBars rows={stats.countries} />
        </Panel>
        <Panel title="New accounts per day">
          <SimpleTable
            head={["Day", "New accounts"]}
            rows={(stats.accounts?.newByDay ?? []).map((row) => [row.day, formatNumber(row.count)])}
            empty={stats.accounts ? "None in this range." : "Accounts are off on this server."}
          />
        </Panel>
      </div>
      <p className="text-2xs text-[#666]">Generated {new Date(stats.generatedAt).toLocaleString("en-GB")}; refreshed at most every 5 minutes.</p>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="border border-[#222] bg-[#111] p-3">
      <div className="text-2xs font-bold uppercase tracking-widest text-[#888]">{label}</div>
      <div className="text-2xl font-black text-[#e6d9b8]">
        {note ? <span className="mr-1 text-xs font-normal text-[#888]">{note}</span> : null}
        {value === null ? "—" : formatNumber(value)}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border border-[#222] bg-[#111] p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text = "No data in this range." }: { text?: string }) {
  return <p className="text-xs text-[#666]">{text}</p>;
}

function RankedBars({ rows, showErrors = false }: { rows: Ranked[]; showErrors?: boolean }) {
  if (rows.length === 0) return <Empty />;
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <table className="w-full text-xs">
      <thead className="sr-only">
        <tr>
          <th>Name</th>
          <th>Count</th>
          {showErrors ? <th>Errors</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 15).map((row) => (
          <tr key={row.key} title={`${row.label}: ${formatNumber(row.count)}`}>
            <td className="w-1/2 truncate py-1 pr-2 text-[#ccc]">{row.label || "(none)"}</td>
            <td className="py-1">
              <div className="flex items-center gap-2">
                <div className="h-2 rounded-r-sm" style={{ width: `${(row.count / max) * 100}%`, minWidth: 2, background: BAR }} />
                <span className="tabular-nums text-[#bbb]">{formatNumber(row.count)}</span>
              </div>
            </td>
            {showErrors ? (
              <td className="py-1 pl-2 text-right tabular-nums text-[#888]">{row.errors ? `${formatNumber(row.errors)} err` : ""}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: string[][]; empty?: string }) {
  if (rows.length === 0) return <Empty text={empty} />;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>
          {head.map((cell, index) => (
            <th key={cell} className={cn("pb-1 font-bold uppercase tracking-widest text-[#888]", index > 0 && "text-right")}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td key={index} className={cn("py-0.5 text-[#ccc]", index > 0 && "text-right tabular-nums")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DistributionTable({ rows }: { rows: Distribution[] }) {
  return (
    <>
      <SimpleTable
        head={["", "Ids", "Median", "p90", "Max"]}
        rows={rows.map((row) => [
          row.signedIn ? "Signed in" : "Visitors",
          formatNumber(row.ids),
          formatNumber(row.p50),
          formatNumber(row.p90),
          formatNumber(row.max),
        ])}
      />
      <p className="text-2xs text-[#666]">Actions are every event except page views, per anonymous id per day.</p>
    </>
  );
}

const CHART_W = 640;
const CHART_H = 180;
const PAD = { top: 8, right: 8, bottom: 22, left: 40 };

function Legend({ keys }: { keys: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-4 text-2xs text-[#bbb]">
      {keys.map((key) => (
        <li key={key.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: key.color }} />
          {key.label}
        </li>
      ))}
    </ul>
  );
}

function Axis({ max }: { max: number }) {
  const ticks = [0, max / 2, max];
  const y = (value: number) => PAD.top + (CHART_H - PAD.top - PAD.bottom) * (1 - value / max);
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#222" />
          <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" fontSize="10" fill="#888">
            {formatNumber(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

function StackedDays({ rows }: { rows: DashboardStats["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <Empty />;
  const keys = ["web", "mcp", "server"] as const;
  const max = Math.max(...rows.map((row) => row.web + row.mcp + row.server), 1);
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const slot = (CHART_W - PAD.left - PAD.right) / rows.length;
  const width = Math.max(2, Math.min(24, slot - 2));
  const active = hover === null ? null : rows[hover];
  return (
    <div className="flex flex-col gap-2">
      <Legend keys={keys.map((key) => ({ label: SERIES_LABEL[key], color: SERIES[key] }))} />
      <p className="h-4 text-2xs text-[#bbb]" aria-live="polite">
        {active
          ? `${active.day}: website ${formatNumber(active.web)} · MCP ${formatNumber(active.mcp)} · server ${formatNumber(active.server)}`
          : "Hover a day for its numbers."}
      </p>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label="Events per day by source">
        <Axis max={max} />
        {rows.map((row, index) => {
          const x = PAD.left + index * slot + (slot - width) / 2;
          let top = PAD.top + plotH;
          return (
            <g key={row.day} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.left + index * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {keys.map((key) => {
                const height = (row[key] / max) * plotH;
                if (height <= 0) return null;
                top -= height;
                // A 2px surface gap between stacked segments.
                return <rect key={key} x={x} y={top} width={width} height={Math.max(0, height - 2)} rx={1} fill={SERIES[key]} />;
              })}
            </g>
          );
        })}
        <text x={PAD.left} y={CHART_H - 6} fontSize="10" fill="#888">
          {rows[0].day}
        </text>
        <text x={CHART_W - PAD.right} y={CHART_H - 6} fontSize="10" fill="#888" textAnchor="end">
          {rows.at(-1)!.day}
        </text>
      </svg>
      <details className="text-xs text-[#888]">
        <summary className="cursor-pointer">Table</summary>
        <SimpleTable
          head={["Day", "Website", "MCP", "Server"]}
          rows={rows.map((row) => [row.day, formatNumber(row.web), formatNumber(row.mcp), formatNumber(row.server)])}
        />
      </details>
    </div>
  );
}

function ActiveLines({ rows }: { rows: { period: string; visitors: number; accounts: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <Empty />;
  const series = [
    { key: "visitors" as const, label: "Visitors (signed out)", color: SERIES.web },
    { key: "accounts" as const, label: "Active accounts", color: SERIES.mcp },
  ];
  const max = Math.max(...rows.flatMap((row) => [row.visitors, row.accounts]), 1);
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH * (1 - value / max);
  const active = hover === null ? null : rows[hover];
  return (
    <div className="flex flex-col gap-2">
      <Legend keys={series} />
      <p className="h-4 text-2xs text-[#bbb]" aria-live="polite">
        {active
          ? `${active.period}: ${formatNumber(active.visitors)} visitors · ${formatNumber(active.accounts)} accounts`
          : "Hover a day for its numbers."}
      </p>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        role="img"
        aria-label="Daily unique visitors and active accounts"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - box.left) / box.width) * CHART_W;
          const index = rows.length === 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (rows.length - 1));
          setHover(Math.max(0, Math.min(rows.length - 1, index)));
        }}
      >
        <Axis max={max} />
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="#555" /> : null}
        {series.map((entry) => (
          <g key={entry.key}>
            <polyline
              fill="none"
              stroke={entry.color}
              strokeWidth={2}
              strokeLinejoin="round"
              points={rows.map((row, index) => `${x(index)},${y(row[entry.key])}`).join(" ")}
            />
            {/* With few days a line is hard to see (one day has none), so each day gets a marker. */}
            {rows.length <= 14
              ? rows.map((row, index) => (
                  <circle key={row.period} cx={x(index)} cy={y(row[entry.key])} r={3} fill={entry.color} />
                ))
              : null}
            {hover !== null ? (
              <circle cx={x(hover)} cy={y(rows[hover][entry.key])} r={4} fill={entry.color} stroke="#111" strokeWidth={2} />
            ) : null}
          </g>
        ))}
        <text x={PAD.left} y={CHART_H - 6} fontSize="10" fill="#888">
          {rows[0].period}
        </text>
        <text x={CHART_W - PAD.right} y={CHART_H - 6} fontSize="10" fill="#888" textAnchor="end">
          {rows.at(-1)!.period}
        </text>
      </svg>
      <details className="text-xs text-[#888]">
        <summary className="cursor-pointer">Table</summary>
        <SimpleTable
          head={["Day", "Visitors", "Accounts"]}
          rows={rows.map((row) => [row.period, formatNumber(row.visitors), formatNumber(row.accounts)])}
        />
      </details>
    </div>
  );
}
