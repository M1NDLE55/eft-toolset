"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Crosshair, Layers, ListChecks, Map as MapIcon, ScanSearch } from "lucide-react";
import { appLinks } from "@/app/lib/links";
import { Rubles } from "@/app/lib/currency";
import { bestSell } from "@/app/lib/item-price";
import { itemHref } from "@/app/lib/item-links";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import { useHydrated } from "@/app/lib/storage/use-store";
import { useScoutedItems } from "@/app/lib/scouted-items/store";
import { useItemsInGroup, useMarketBoard } from "@/app/lib/cache/hooks";
import type { MarketRow } from "@/app/lib/cache/types";
import { changeSinceLastVisit, usePriceHistories, type PricePoint } from "@/app/lib/price-history";
import { ChangeBadge } from "@/app/components/item/price-trend";
import { useGroups } from "@/app/lib/item-groups/store";
import type { Group } from "@/app/lib/item-groups/validation";
import { sortBuilds, useBuilds, usePriceSources } from "@/app/lib/builds/store";
import { collectItemIds, countParts } from "@/app/lib/builds/tree";
import { computeStats, isDetailed } from "@/app/lib/builds/stats";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import { useAmmoItems, useGunItems, useGunList, usePurchaseContext } from "@/app/lib/cache/gunBuilderHooks";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import { formatRub } from "@/app/components/gun-builder/format";
import { usePlans } from "@/app/lib/raid-planner/store";
import { getMapConfig, mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { planThumbnail } from "@/app/lib/raid-planner/thumbnail";
import { prefetchMap } from "@/app/lib/raid-planner/prefetch";
import { getPlanDisplayColor, type RaidPlan } from "@/app/lib/raid-planner/types";
import { useGameMode } from "@/components/game-mode/context";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const focus = "focus-visible:outline-2 focus-visible:outline-[#9a8866]";
const eyebrow = "text-[10px] font-bold uppercase tracking-widest";
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const toolIcons = {
  "/item": ScanSearch,
  "/item-groups": Layers,
  "/gun-builder": Crosshair,
  "/raid-planner": MapIcon,
  "/quests": ListChecks,
} as const;

function ago(timestamp: number, now: number) {
  const minutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ItemIcon({ src, size = 28 }: { src: string | null | undefined; size?: number }) {
  const style = { width: size, height: size };
  return src ? (
    <Image src={src} alt="" width={size} height={size} style={style} className="shrink-0 bg-[#111] object-contain" />
  ) : (
    <span style={style} className="shrink-0 bg-[#151515]" />
  );
}

function Percent({ value, title }: { value: number; title?: string }) {
  const up = value > 0;
  return (
    <span title={title} className={cn("text-[10px] font-semibold tabular-nums", up ? "text-emerald-400" : "text-red-400")}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/** The change since the viewer last saw the price, or the 48-hour flea change when there is none. */
function PriceChange({
  points,
  price,
  percent48h,
  now,
}: {
  points: readonly PricePoint[];
  price: number | null;
  percent48h: number | null | undefined;
  now: number;
}) {
  const seen = price !== null ? changeSinceLastVisit(points, price, now) : null;
  if (seen && Math.abs(seen.ratio) >= 0.005) return <ChangeBadge points={points} price={price} now={now} />;
  if (percent48h && Math.abs(percent48h) >= 0.5) return <Percent value={percent48h} title="Flea price over the last 48 hours" />;
  return null;
}

export function Panel({
  title,
  href,
  hint,
  className,
  children,
}: {
  title: string;
  href: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const id = `home-${href.slice(1)}`;
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 border border-[#1a1a1a] bg-[#0c0c0c] p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="min-w-0">
          <Link
            href={href}
            className={cn("group flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-[#ddd] hover:text-[#e6d9b8]", focus)}
          >
            <span className="truncate">{title}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9a8866] transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </h2>
        {hint && <span className={cn(eyebrow, "shrink-0 text-[#9a8866]")}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children, href, action }: { children: ReactNode; href: string; action: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-2 border border-dashed border-[#222] p-4">
      <p className="text-sm text-[#888]">{children}</p>
      <Link href={href} className={cn(eyebrow, "text-[#c8b384] underline-offset-4 hover:underline", focus)}>
        {action}
      </Link>
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}

const rowClass = cn(
  "group -mx-2 flex min-w-0 items-center gap-2.5 px-2 py-1.5 transition-colors hover:bg-[#121212]",
  focus
);

export function RecentItemsPanel({ limit = 5, className }: { limit?: number; className?: string }) {
  const hydrated = useHydrated();
  const scouted = useScoutedItems();
  const { gameMode } = useGameMode();
  const [now] = useState(() => Date.now());
  const shown = useMemo(() => scouted.slice(0, limit), [scouted, limit]);
  const names = useMemo(() => shown.map((item) => item.name), [shown]);
  const { items } = useItemsInGroup(names);
  const history = usePriceHistories(gameMode, names, hydrated);
  const byName = new Map(items.map((item) => [item.name, item]));

  return (
    <Panel title="Item prices" href="/item" hint={shown.length > 0 ? "Recently viewed" : undefined} className={className}>
      {!hydrated ? (
        <Rows count={4} />
      ) : shown.length === 0 ? (
        <Empty href="/item" action="Check item prices">
          Search any item above for prices, slot value, and every task, barter and craft that uses it. The ones you
          view show up here.
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => {
            const data = byName.get(item.name);
            const best = data ? bestSell(data) : null;
            return (
              <li key={item.name}>
                <Link href={itemHref(item)} className={rowClass}>
                  <ItemIcon src={item.gridImageLink} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[#bbb] group-hover:text-[#e6d9b8]">{item.name}</span>
                  <PriceChange
                    points={history(item.name)}
                    price={best?.price ?? null}
                    percent48h={data?.changeLast48hPercent}
                    now={now}
                  />
                  <span className="shrink-0 text-sm tabular-nums text-[#ddd]">{best ? Rubles.format(best.price) : "—"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function StatBar({ label, value, share }: { label: string; value: string; share: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-[#888]">
      <span className="w-10 shrink-0">{label}</span>
      <span className="h-[3px] flex-1 bg-[#1a1a1a]" aria-hidden>
        <span className="block h-full bg-[#9a8866]" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums text-[#ccc]">{value}</span>
    </div>
  );
}

function LatestBuild({ build }: { build: GunBuild }) {
  const ids = useMemo(() => collectItemIds(build.root), [build.root]);
  const { items, loading } = useGunItems(ids, "full");
  const priceSources = usePriceSources();
  const { byId } = useGunList();
  const ammoIds = useMemo(() => (build.ammoId ? [build.ammoId] : []), [build.ammoId]);
  const { items: ammoItems } = useAmmoItems(ammoIds);

  const gun = byId.get(build.weaponId);
  const weaponData = items.get(build.weaponId);
  const weapon = isDetailed(weaponData) ? weaponData : null;
  const ammoData = build.ammoId ? ammoItems.get(build.ammoId) : undefined;
  const ammo = ammoData && ammoFits(build.ammoId, ammoOptions(build.root, items)) ? ammoData : null;
  const pricing = usePurchaseContext(build.weaponId, weapon?.defaultPresetId ?? gun?.defaultPresetId, items);
  const stats = computeStats(build.root, items, priceSources, ammo, pricing);
  const image = weaponData?.gridImageLink ?? gun?.gridImageLink ?? null;
  const ready = !loading && weapon !== null;

  return (
    <Link href={`/gun-builder/${build.id}`} className={cn("group flex min-w-0 items-center gap-4", focus)}>
      <span className="flex h-14 w-24 shrink-0 items-center justify-center bg-[#080808]">
        {image && <Image src={image} alt="" width={96} height={56} className="h-full w-full object-contain p-1" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold text-[#ddd] group-hover:text-[#e6d9b8]">
          {build.name || "Untitled build"}
        </span>
        {ready ? (
          <>
            <span className="text-sm tabular-nums text-[#ccc]">
              {formatRub(stats.costRUB)}
              {stats.costMissingCount > 0 && <span className="text-[#888]"> + {plural(stats.costMissingCount, "unpriced part")}</span>}
            </span>
            {stats.ergonomics !== null && (
              <StatBar label="Ergo" value={String(Math.round(stats.ergonomics))} share={stats.ergonomics / 100} />
            )}
            {stats.recoilVertical !== null && (
              <StatBar label="Recoil" value={String(Math.round(stats.recoilVertical))} share={stats.recoilVertical / 200} />
            )}
          </>
        ) : (
          <span className="text-xs text-[#888]">
            {gun?.shortName ?? "Weapon"} · {plural(countParts(build.root), "part")}
          </span>
        )}
      </span>
    </Link>
  );
}

export function BuildsPanel({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const builds = sortBuilds(useBuilds());
  const { byId } = useGunList();
  const [latest, ...others] = builds;

  return (
    <Panel title="Gun builder" href="/gun-builder" hint={latest ? "Latest build" : undefined} className={className}>
      {!hydrated ? (
        <Rows count={2} />
      ) : !latest ? (
        <Empty href="/gun-builder" action="Create your first build">
          Start from a factory preset, swap parts, and watch ergonomics, recoil and cost update live.
        </Empty>
      ) : (
        <>
          <LatestBuild key={latest.id} build={latest} />
          {others.length > 0 && (
            <ul className="flex flex-col border-t border-[#161616] pt-2">
              {others.slice(0, 2).map((build) => (
                <li key={build.id}>
                  <Link href={`/gun-builder/${build.id}`} className={rowClass}>
                    <span className="min-w-0 flex-1 truncate text-sm text-[#aaa] group-hover:text-[#e6d9b8]">
                      {build.name || "Untitled build"}
                    </span>
                    <span className="shrink-0 text-xs text-[#777]">{byId.get(build.weaponId)?.shortName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

export function PlanThumbnail({ plan, className }: { plan: RaidPlan; className?: string }) {
  const config = getMapConfig(plan.mapKey);
  const thumbnail = config ? planThumbnail(plan, config, 320, 180) : null;
  const patternId = `grid-${plan.id}`;
  const last = thumbnail?.waypoints.at(-1);
  return (
    <svg viewBox="0 0 320 180" className={cn("block w-full border border-[#1a1a1a] bg-[#090a09]", className)} aria-hidden>
      <defs>
        <pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#141614" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="320" height="180" fill={`url(#${patternId})`} />
      {thumbnail ? (
        <>
          {thumbnail.drawings.map((drawing, index) => (
            <polyline
              key={index}
              points={drawing.points}
              fill="none"
              stroke={getPlanDisplayColor(drawing.color)}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />
          ))}
          {thumbnail.route && (
            <polyline
              points={thumbnail.route}
              fill="none"
              stroke="#c8b384"
              strokeWidth="2.5"
              strokeDasharray="7 4"
              strokeLinejoin="round"
            />
          )}
          {thumbnail.waypoints.slice(1, -1).map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r="3" fill="#090a09" stroke="#c8b384" strokeWidth="1.5" />
          ))}
          {thumbnail.notes.map((note, index) => (
            <rect
              key={index}
              x={note.x - 4}
              y={note.y - 4}
              width="8"
              height="8"
              fill={getPlanDisplayColor(note.color)}
              transform={`rotate(45 ${note.x} ${note.y})`}
            />
          ))}
          {thumbnail.waypoints[0] && <circle cx={thumbnail.waypoints[0].x} cy={thumbnail.waypoints[0].y} r="5" fill="#c8b384" />}
          {last && thumbnail.waypoints.length > 1 && <rect x={last.x - 5} y={last.y - 5} width="10" height="10" fill="#34d399" />}
        </>
      ) : (
        <text x="160" y="94" textAnchor="middle" fill="#555" fontSize="11" letterSpacing="2">
          NOTHING DRAWN YET
        </text>
      )}
    </svg>
  );
}

export function PlansPanel({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const plans = usePlans();
  const { gameMode } = useGameMode();
  const [now] = useState(() => Date.now());
  const [latest, ...others] = plans;
  const warm = (plan: RaidPlan) => {
    const config = getMapConfig(plan.mapKey);
    if (config) prefetchMap(config, gameMode);
  };

  return (
    <Panel title="Raid planner" href="/raid-planner" hint={latest ? "Continue" : undefined} className={className}>
      {!hydrated ? (
        <Skeleton className="aspect-video w-full" />
      ) : !latest ? (
        <Empty href="/raid-planner" action="Plan a raid">
          Draw routes, arrows and notes on any map, then share the plan with your squad as a link.
        </Empty>
      ) : (
        <>
          <Link
            href={`/raid-planner/${latest.id}`}
            onPointerEnter={() => warm(latest)}
            onFocus={() => warm(latest)}
            className={cn("group flex flex-col gap-2", focus)}
          >
            <PlanThumbnail plan={latest} className="transition-colors group-hover:border-[#9a8866]" />
            <span className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-[#ddd] group-hover:text-[#e6d9b8]">
                {latest.name || "Untitled raid"}
              </span>
              <span className="text-xs text-[#888]">
                {getMapConfig(latest.mapKey)?.name ?? "Unknown map"} · edited {ago(latest.updatedAt, now)}
              </span>
            </span>
          </Link>
          {others.length > 0 && (
            <ul className="flex flex-col border-t border-[#161616] pt-2">
              {others.slice(0, 3).map((plan) => (
                <li key={plan.id}>
                  <Link href={`/raid-planner/${plan.id}`} onPointerEnter={() => warm(plan)} onFocus={() => warm(plan)} className={rowClass}>
                    <span className="min-w-0 flex-1 truncate text-sm text-[#aaa] group-hover:text-[#e6d9b8]">
                      {plan.name || "Untitled raid"}
                    </span>
                    <span className="shrink-0 text-xs text-[#777]">{getMapConfig(plan.mapKey)?.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function GroupTile({ group, now }: { group: Group; now: number }) {
  const { gameMode } = useGameMode();
  const { items, loading } = useItemsInGroup(group.items);
  const history = usePriceHistories(gameMode, group.items);
  let total = 0;
  let current = 0;
  let previous = 0;
  for (const item of items) {
    const best = bestSell(item);
    if (!best) continue;
    total += best.price;
    const seen = changeSinceLastVisit(history(item.name), best.price, now);
    if (seen) {
      current += best.price;
      previous += seen.previous;
    }
  }
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;

  return (
    <Link
      href={`/item-groups/${customEncodeURI(group.name)}`}
      className={cn(
        "group flex min-w-0 flex-col gap-1 border border-[#1a1a1a] bg-[#0a0a0a] p-3 transition-colors hover:border-[#9a8866]",
        focus
      )}
    >
      <span className="truncate text-xs text-[#999] group-hover:text-[#e6d9b8]">{group.name}</span>
      <span className="flex items-baseline gap-2">
        {group.items.length === 0 ? (
          <span className="text-sm text-[#777]">Empty</span>
        ) : loading ? (
          <Skeleton className="h-6 w-28" />
        ) : (
          <span className="text-lg font-semibold tabular-nums text-[#ddd]">{Rubles.format(total)}</span>
        )}
        {Math.abs(change) >= 0.5 && <Percent value={change} title="Since your last visit" />}
      </span>
      <span className="text-[11px] text-[#777]">{plural(group.items.length, "item")}</span>
    </Link>
  );
}

export function GroupsPanel({ limit = 3, className }: { limit?: number; className?: string }) {
  const hydrated = useHydrated();
  const groups = useGroups();
  const [now] = useState(() => Date.now());

  return (
    <Panel title="Item groups" href="/item-groups" hint={groups.length > 0 ? "Watchlists" : undefined} className={className}>
      {!hydrated ? (
        <Skeleton className="h-20 w-full" />
      ) : groups.length === 0 ? (
        <Empty href="/item-groups" action="Create a group">
          Track the loot you care about with live best-sell prices and totals.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {groups.slice(0, limit).map((group) => (
            <GroupTile key={group.name} group={group} now={now} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function MoverList({ title, hint, rows, mode }: { title: string; hint: string; rows: MarketRow[] | null; mode: "change" | "slot" }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#ddd]">{title}</h2>
        <span className={cn(eyebrow, "text-[#9a8866]")}>{hint}</span>
      </div>
      {!rows ? (
        <Rows count={6} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-[#777]">Nothing to show right now.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.name}>
              <Link href={itemHref(row)} title={row.name} className={rowClass}>
                <ItemIcon src={row.gridImageLink} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-[#bbb] group-hover:text-[#e6d9b8]">{row.shortName || row.name}</span>
                  <span className="truncate text-[11px] tabular-nums text-[#777]">
                    {mode === "slot" ? `${Rubles.format(row.price)} · ${row.vendor}` : Rubles.format(row.price)}
                  </span>
                </span>
                {mode === "slot" ? (
                  <span className="shrink-0 text-sm tabular-nums text-[#ddd]">{Rubles.format(row.perSlot)}</span>
                ) : (
                  row.changeLast48hPercent !== null && <Percent value={row.changeLast48hPercent} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MarketBoardPanels() {
  const { board, error, retry } = useMarketBoard();
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border border-red-900/60 bg-[#0c0c0c] p-4 text-sm text-red-200">
        The market board could not be loaded.
        <button type="button" onClick={retry} className={cn("underline underline-offset-2 hover:text-[#e6d9b8]", focus)}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <MoverList title="Risers" hint="Flea · 48 h" rows={board?.risers ?? null} mode="change" />
      <MoverList title="Fallers" hint="Flea · 48 h" rows={board?.fallers ?? null} mode="change" />
      <MoverList title="Best per slot" hint="Sell value" rows={board?.perSlot ?? null} mode="slot" />
    </div>
  );
}

export function MapsGrid() {
  const hydrated = useHydrated();
  const plans = usePlans();
  const { gameMode } = useGameMode();
  const counts = new Map<string, number>();
  for (const plan of plans) counts.set(plan.mapKey, (counts.get(plan.mapKey) ?? 0) + 1);

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {mapConfigs.map((config) => {
        const count = hydrated ? (counts.get(config.key) ?? 0) : 0;
        const levels = config.floors.length + 1;
        return (
          <li key={config.key} className="contents">
            <Link
              href={`/raid-planner/map/${config.key}`}
              onPointerEnter={() => prefetchMap(config, gameMode)}
              onFocus={() => prefetchMap(config, gameMode)}
              onTouchStart={() => prefetchMap(config, gameMode)}
              className={cn(
                "group flex min-h-20 flex-col justify-between gap-2 border bg-[#0c0c0c] p-3 transition-colors hover:border-[#9a8866] hover:bg-[#100f0c]",
                count > 0 ? "border-[#4a4232]" : "border-[#1a1a1a]",
                focus
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-xs font-bold uppercase tracking-widest text-[#ddd] group-hover:text-[#e6d9b8]">
                  {config.name}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#555] transition-colors group-hover:text-[#9a8866]" aria-hidden />
              </span>
              <span className={cn(eyebrow, count > 0 ? "text-[#c8b384]" : "text-[#777]")}>
                {count > 0 ? plural(count, "saved plan") : plural(levels, "level")}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ToolLinks({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <nav aria-label="Tools" className={cn("grid w-full grid-cols-1 gap-3", compact ? "sm:grid-cols-2 lg:grid-cols-5" : "sm:grid-cols-2", className)}>
      {appLinks.map((link) => {
        const Icon = toolIcons[link.href as keyof typeof toolIcons];
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "group flex items-start gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-4 transition-colors hover:border-[#9a8866] hover:bg-[#100f0c]",
              compact && "items-center gap-3 p-3",
              focus
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center border border-[#2a2a2a] text-[#9a8866] transition-colors group-hover:border-[#9a8866]",
                compact ? "h-8 w-8" : "h-10 w-10"
              )}
            >
              <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-widest text-[#ddd] group-hover:text-[#e6d9b8]">{link.title}</span>
              {!compact && <span className="text-sm text-[#888]">{link.description}</span>}
            </span>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#9a8866] transition-transform group-hover:translate-x-0.5" />
          </Link>
        );
      })}
    </nav>
  );
}
