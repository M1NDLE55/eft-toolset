"use client";

import { AlertTriangle } from "lucide-react";
import type { BuildStats } from "@/app/lib/builds/stats";
import type { PriceSources } from "@/app/lib/types/gunBuilder";

function rub(value: number | null) {
  if (value === null) return "-";
  return `${Math.round(value).toLocaleString()} RUB`;
}

function stat(value: number | null, suffix = "") {
  if (value === null) return "-";
  return `${Math.round(value)}${suffix}`;
}

function SourceBadge({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
        active
          ? "border-[#9a8866] bg-[#9a8866] text-[#070707]"
          : "border-[#2a2a2a] text-[#888] hover:border-[#4a4234]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function StatsPanel({
  stats,
  priceSources,
  onPriceSourcesChange,
}: {
  stats: BuildStats;
  priceSources: PriceSources;
  onPriceSourcesChange: (sources: PriceSources) => void;
}) {
  const hasMissing = stats.missingRequiredSlots.length > 0;
  const hasMissingPrices = stats.costMissingCount > 0;
  const noSources = !priceSources.traders && !priceSources.flea;

  return (
    <div className="border border-[#2a2a2a] bg-[#090909] p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Ergo
          </p>
          <p className="text-lg font-black text-[#ccc]">
            {stat(stats.ergonomics)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Vertical
          </p>
          <p className="text-lg font-black text-[#ccc]">
            {stat(stats.recoilVertical)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Horizontal
          </p>
          <p className="text-lg font-black text-[#ccc]">
            {stat(stats.recoilHorizontal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Weight
          </p>
          <p className="text-lg font-black text-[#ccc]">
            {stats.weight.toFixed(2)} kg
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Cost{hasMissingPrices ? "*" : ""}
          </p>
          <p className="text-lg font-black text-[#ccc]">{rub(stats.costRUB)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#1a1a1a] pt-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
          Cost from
        </span>
        <SourceBadge
          label="Traders"
          active={priceSources.traders}
          onClick={() =>
            onPriceSourcesChange({
              ...priceSources,
              traders: !priceSources.traders,
            })
          }
        />
        <SourceBadge
          label="Flea"
          active={priceSources.flea}
          onClick={() =>
            onPriceSourcesChange({ ...priceSources, flea: !priceSources.flea })
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#1a1a1a] pt-3 text-xs text-[#888]">
        <span>Recoil is an approximation.</span>
        {noSources ? (
          <span className="text-[#9a8866]">
            Select a price source to see build cost.
          </span>
        ) : (
          hasMissingPrices && (
            <span>
              *Cost excludes {stats.costMissingCount} item
              {stats.costMissingCount === 1 ? "" : "s"} with no price from the
              selected source{priceSources.traders && priceSources.flea ? "s" : ""}.
            </span>
          )
        )}
        {hasMissing && (
          <span className="inline-flex items-center gap-1 text-[#9a8866]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {stats.missingRequiredSlots.length} required slot
            {stats.missingRequiredSlots.length === 1 ? "" : "s"} empty
          </span>
        )}
      </div>
    </div>
  );
}
