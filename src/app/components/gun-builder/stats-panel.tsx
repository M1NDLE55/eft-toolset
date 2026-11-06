"use client";

import { AlertTriangle, Plus } from "lucide-react";
import type { BuildStats, MissingSlot } from "@/app/lib/builds/stats";
import type { PriceSources } from "@/app/lib/types/gunBuilder";
import { cn } from "@/lib/utils";
import { formatRub } from "./format";

function Delta({ value, better, digits = 0 }: { value: number; better: "up" | "down"; digits?: number }) {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  if (rounded === 0) return null;
  const good = better === "up" ? rounded > 0 : rounded < 0;
  return (
    <span className={cn("text-[11px] font-bold tabular-nums", good ? "text-emerald-300" : "text-red-300")}>
      {rounded > 0 ? "+" : ""}
      {rounded.toFixed(digits)}
    </span>
  );
}

function Stat({
  label,
  shortLabel,
  value,
  delta,
  loading,
  className,
}: {
  label: string;
  shortLabel?: string;
  value: string;
  delta?: React.ReactNode;
  loading: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 bg-[#0c0c0c] px-3 py-2 sm:py-2.5", className)}>
      <dt className="truncate text-[10px] font-bold uppercase tracking-widest text-[#888]">
        {shortLabel ? (
          <>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="max-sm:hidden">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {loading ? (
          <span className="h-6 w-16 animate-shimmer" />
        ) : (
          <>
            <span className="truncate text-base font-black tabular-nums text-[#e6d9b8] sm:text-lg">{value}</span>
            {delta}
          </>
        )}
      </dd>
    </div>
  );
}

function SourceToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 px-3 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8]",
        active ? "bg-[#9a8866] text-[#070707]" : "text-[#888] hover:text-[#ccc]"
      )}
    >
      {label}
    </button>
  );
}

export function StatsPanel({
  stats,
  loading,
  priceSources,
  onPriceSourcesChange,
  onFillSlot,
}: {
  stats: BuildStats;
  loading: boolean;
  priceSources: PriceSources;
  onPriceSourcesChange: (sources: PriceSources) => void;
  onFillSlot: (slot: MissingSlot) => void;
}) {
  const base = stats.base;
  const noSources = !priceSources.traders && !priceSources.flea;
  const statsLoading = loading && !base;

  return (
    <section aria-label="Build stats" className="flex flex-col gap-px border border-[#1a1a1a] bg-[#1a1a1a]">
      <dl className="grid grid-cols-6 gap-px lg:grid-cols-5">
        <Stat
          label="Ergonomics"
          shortLabel="Ergo"
          className="col-span-2 lg:col-span-1"
          loading={statsLoading}
          value={stats.ergonomics === null ? "—" : String(Math.round(stats.ergonomics))}
          delta={base && stats.ergonomics !== null && <Delta value={stats.ergonomics - base.ergonomics} better="up" />}
        />
        <Stat
          label="Vertical recoil"
          shortLabel="Recoil V"
          className="col-span-2 lg:col-span-1"
          loading={statsLoading}
          value={stats.recoilVertical === null ? "—" : String(Math.round(stats.recoilVertical))}
          delta={
            base?.recoilVertical != null &&
            stats.recoilVertical !== null && <Delta value={stats.recoilVertical - base.recoilVertical} better="down" />
          }
        />
        <Stat
          label="Horizontal recoil"
          shortLabel="Recoil H"
          className="col-span-2 lg:col-span-1"
          loading={statsLoading}
          value={stats.recoilHorizontal === null ? "—" : String(Math.round(stats.recoilHorizontal))}
          delta={
            base?.recoilHorizontal != null &&
            stats.recoilHorizontal !== null && <Delta value={stats.recoilHorizontal - base.recoilHorizontal} better="down" />
          }
        />
        <Stat
          label="Weight"
          className="col-span-3 lg:col-span-1"
          loading={statsLoading}
          value={`${stats.weight.toFixed(2)} kg`}
          delta={base && <Delta value={stats.weight - base.weight} better="down" digits={2} />}
        />
        <Stat
          label={stats.costMissingCount > 0 && !noSources ? "Cost*" : "Cost"}
          loading={statsLoading}
          value={noSources ? "—" : formatRub(stats.costRUB)}
          className="col-span-3 lg:col-span-1"
        />
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#0c0c0c] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#666]">Prices</span>
          <div role="group" aria-label="Price sources" className="flex border border-[#2a2a2a]">
            <SourceToggle
              label="Traders"
              active={priceSources.traders}
              onClick={() => onPriceSourcesChange({ ...priceSources, traders: !priceSources.traders })}
            />
            <SourceToggle
              label="Flea"
              active={priceSources.flea}
              onClick={() => onPriceSourcesChange({ ...priceSources, flea: !priceSources.flea })}
            />
          </div>
        </div>
        <p className="text-xs text-[#777]">
          {noSources
            ? "Select a price source to see the build cost."
            : stats.costMissingCount > 0
              ? `*${stats.costMissingCount} part${stats.costMissingCount === 1 ? " has" : "s have"} no price from the selected source${priceSources.traders && priceSources.flea ? "s" : ""}.`
              : "Cheapest of the selected sources. Recoil is an estimate."}
        </p>
      </div>

      {stats.missingRequired.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-[#0e0b07] px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-[#c8b384]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {stats.missingRequired.length} required slot{stats.missingRequired.length === 1 ? "" : "s"} empty
          </span>
          {stats.missingRequired.map((missing) => (
            <button
              key={`${missing.parentPath.join("/")}/${missing.slot.id}`}
              type="button"
              onClick={() => onFillSlot(missing)}
              title={missing.label}
              className="flex h-8 max-w-full items-center gap-1 border border-dashed border-[#7a6a48] px-2 text-[10px] font-bold uppercase tracking-widest text-[#c8b384] transition-colors hover:border-[#c8b384] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#e6d9b8]"
            >
              <Plus className="h-3 w-3 shrink-0" />
              <span className="truncate">{missing.slot.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
