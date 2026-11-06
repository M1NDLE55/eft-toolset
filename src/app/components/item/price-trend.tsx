import { Rubles } from "@/app/lib/currency";
import { changeSinceLastVisit, type PricePoint } from "@/app/lib/price-history";
import { cn } from "@/lib/utils";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(timestamp: number, now: number) {
  const minutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export function ChangeBadge({ points, price, now }: { points: readonly PricePoint[]; price: number | null; now: number }) {
  const change = price !== null ? changeSinceLastVisit(points, price, now) : null;
  if (!change || Math.abs(change.ratio) < 0.005) return null;
  const up = change.ratio > 0;
  return (
    <span
      title={`Was ${Rubles.format(change.previous)} ${ago(change.since, now)}`}
      className={cn("text-[10px] font-semibold tabular-nums", up ? "text-emerald-400" : "text-red-400")}
    >
      {up ? "▲" : "▼"} {Math.abs(change.ratio * 100).toFixed(1)}%
    </span>
  );
}

export function PriceTrend({ points, price, now }: { points: readonly PricePoint[]; price: number; now: number }) {
  const series = [...points.filter((point) => now - point.t > 60_000), { t: now, p: price }];
  if (series.length < 2) return null;
  const change = changeSinceLastVisit(points, price, now);
  const values = series.map((point) => point.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const start = series[0].t;
  const span = Math.max(1, now - start);
  const range = Math.max(1, max - min);
  const path = series
    .map((point, index) => {
      const x = ((point.t - start) / span) * 100;
      const y = 28 - ((point.p - min) / range) * 24;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const up = change ? change.ratio >= 0 : values.at(-1)! >= values[0];

  return (
    <section aria-label="Your price history" className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#777]">Best sell, as you&apos;ve seen it</h2>
        {change && (
          <p className="text-xs text-[#999]">
            <span className={cn("font-semibold tabular-nums", up ? "text-emerald-400" : "text-red-400")}>
              {change.ratio > 0 ? "+" : ""}
              {(change.ratio * 100).toFixed(1)}%
            </span>{" "}
            since {ago(change.since, now)}
          </p>
        )}
      </div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label={`Price ranged from ${Rubles.format(min)} to ${Rubles.format(max)}`}>
        <path d={path} fill="none" stroke={up ? "#34d399" : "#f87171"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-[#777]">
        <span>{ago(start, now)}</span>
        <span>
          {Rubles.format(min)} – {Rubles.format(max)}
        </span>
      </div>
    </section>
  );
}
