import type { StatDelta, StatKey } from "@/app/lib/builds/compare";
import { cn } from "@/lib/utils";
import { formatRub, formatWeight } from "./format";

const SHORT_LABELS: Record<StatKey, string> = {
  ergonomics: "Ergo",
  recoilVertical: "Recoil V",
  recoilHorizontal: "Recoil H",
  weight: "Weight",
  costRUB: "Cost",
  partCount: "Parts",
};

function formatValue(key: StatKey, value: number | null) {
  if (value === null) return "—";
  if (key === "costRUB") return formatRub(value);
  if (key === "weight") return formatWeight(value);
  return String(Math.round(value));
}

function formatDelta(key: StatKey, value: number | null) {
  if (value === null || value === 0) return "±0";
  const sign = value > 0 ? "+" : "−";
  const magnitude = Math.abs(value);
  if (key === "costRUB") return `${sign}${formatRub(magnitude)}`;
  if (key === "weight") return `${sign}${magnitude.toFixed(2)}`;
  return `${sign}${Math.round(magnitude)}`;
}

export function StatDeltaTable({
  rows,
  leftLabel,
  rightLabel,
  loading = false,
}: {
  rows: StatDelta[];
  leftLabel: string;
  rightLabel: string;
  loading?: boolean;
}) {
  return (
    <table className="w-full table-fixed border-collapse border border-[#1a1a1a] bg-[#0c0c0c] text-sm">
      <thead>
        <tr className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
          <th scope="col" className="w-[25%] px-2 py-2 text-left font-bold sm:w-[28%] sm:px-3">Stat</th>
          <th scope="col" className="truncate px-2 py-2 text-right font-bold tracking-wider sm:tracking-widest" title={leftLabel}>{leftLabel}</th>
          <th scope="col" className="truncate px-2 py-2 text-right font-bold tracking-wider sm:tracking-widest" title={rightLabel}>{rightLabel}</th>
          <th scope="col" className="w-[26%] px-2 py-2 text-right font-bold sm:w-[22%] sm:px-3">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-[#161616]">
            <th scope="row" className="truncate px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#aaa] sm:px-3 sm:tracking-widest">
              <span className="sm:hidden">{SHORT_LABELS[row.key]}</span>
              <span className="max-sm:hidden">{row.label}</span>
            </th>
            {[row.left, row.right].map((value, index) => (
              <td key={index} className="truncate px-2 py-2 text-right text-xs font-black tabular-nums text-[#e6d9b8] sm:text-sm">
                {loading ? <span className="ml-auto block h-4 w-12 animate-shimmer" /> : formatValue(row.key, value)}
              </td>
            ))}
            <td
              className={cn(
                "whitespace-nowrap px-2 py-2 text-right text-xs font-bold tabular-nums sm:px-3",
                row.verdict === "better" ? "text-emerald-300" : row.verdict === "worse" ? "text-red-300" : "text-[#777]"
              )}
            >
              {loading ? null : formatDelta(row.key, row.delta)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
