"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, ExternalLink } from "lucide-react";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import { useHydrated } from "@/app/lib/storage/use-store";
import { findBuild, sortBuilds, useBuilds, usePriceSources, setPriceSources } from "@/app/lib/builds/store";
import { collectItemIds, countParts } from "@/app/lib/builds/tree";
import { computeStats, isDetailed } from "@/app/lib/builds/stats";
import { diffBuildTrees, statDeltas } from "@/app/lib/builds/compare";
import { useAmmoItems, useGunItems, useGunList, usePurchaseContext } from "@/app/lib/cache/gunBuilderHooks";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatDeltaTable } from "@/app/components/gun-builder/stat-deltas";
import { DiffList } from "@/app/components/gun-builder/diff-list";
import { PriceSourcesControl } from "@/app/components/gun-builder/stats-panel";
import { formatDate, modeLabel } from "@/app/components/gun-builder/format";
import { useDocumentTitle } from "@/app/components/gun-builder/use-document-title";
import { cn } from "@/lib/utils";

function CompareSkeleton() {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function CompareBuildsPage() {
  return (
    <Suspense fallback={<CompareSkeleton />}>
      <CompareBuilds />
    </Suspense>
  );
}

function CompareBuilds() {
  const hydrated = useHydrated();
  const builds = sortBuilds(useBuilds());
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useDocumentTitle("Compare builds");

  if (!hydrated) return <CompareSkeleton />;

  const requestedA = params.get("a");
  const requestedB = params.get("b");
  const left = (requestedA && findBuild(builds, requestedA)) || builds[0];
  const right =
    (requestedB && requestedB !== left?.id && findBuild(builds, requestedB)) ||
    builds.find((build) => build.id !== left?.id);

  function select(side: "a" | "b", id: string) {
    const next = new URLSearchParams();
    const a = side === "a" ? id : left?.id;
    const b = side === "b" ? id : right?.id;
    if (a) next.set("a", a);
    if (b) next.set("b", b);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <Link
        href="/gun-builder"
        className="inline-flex h-6 w-fit items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All builds
      </Link>
      <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Compare builds</h1>

      {!left || !right ? (
        <div className="flex flex-col items-center gap-3 border border-dashed border-[#2a2a2a] px-6 py-12 text-center">
          <p className="font-semibold text-[#ccc]">You need at least two saved builds</p>
          <p className="max-w-sm text-sm text-[#888]">Duplicate a build and change some parts to see the difference side by side.</p>
          <Button asChild variant="outline" className="mt-1">
            <Link href={left ? `/gun-builder/${left.id}` : "/gun-builder"}>{left ? "Open your build" : "Go to builds"}</Link>
          </Button>
        </div>
      ) : (
        <Comparison
          key={`${left.id}:${right.id}`}
          builds={builds}
          left={left}
          right={right}
          onSelect={select}
          onSwap={() => {
            const next = new URLSearchParams({ a: right.id, b: left.id });
            router.replace(`${pathname}?${next.toString()}`, { scroll: false });
          }}
        />
      )}
    </div>
  );
}

function BuildSelect({
  label,
  value,
  exclude,
  builds,
  onChange,
}: {
  label: string;
  value: string;
  exclude: string;
  builds: GunBuild[];
  onChange: (id: string) => void;
}) {
  const { byId } = useGunList();
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#888]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-sm text-[#ddd] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9a8866]"
      >
        {builds.map((build) => (
          <option key={build.id} value={build.id} disabled={build.id === exclude}>
            {(build.name || "Untitled build").slice(0, 60)} · {byId.get(build.weaponId)?.shortName ?? "Weapon"}
          </option>
        ))}
      </select>
    </label>
  );
}

function Comparison({
  builds,
  left,
  right,
  onSelect,
  onSwap,
}: {
  builds: GunBuild[];
  left: GunBuild;
  right: GunBuild;
  onSelect: (side: "a" | "b", id: string) => void;
  onSwap: () => void;
}) {
  const ids = useMemo(
    () => Array.from(new Set([...collectItemIds(left.root), ...collectItemIds(right.root)])),
    [left.root, right.root]
  );
  const { items, loading, error, retry, gameMode } = useGunItems(ids, "full");
  const priceSources = usePriceSources();
  const { byId } = useGunList();
  const [showSame, setShowSame] = useState(false);

  const ammoIds = useMemo(
    () => [left.ammoId, right.ammoId].filter((id): id is string => Boolean(id)),
    [left.ammoId, right.ammoId]
  );
  const { items: ammoItems } = useAmmoItems(ammoIds);
  const ammoFor = (build: GunBuild) => {
    const ammo = build.ammoId ? ammoItems.get(build.ammoId) : undefined;
    return ammo && ammoFits(ammo.id, ammoOptions(build.root, items)) ? ammo : null;
  };
  const presetOf = (weaponId: string) => {
    const weapon = items.get(weaponId);
    return (isDetailed(weapon) ? weapon.defaultPresetId : null) ?? byId.get(weaponId)?.defaultPresetId;
  };
  const leftPricing = usePurchaseContext(left.weaponId, presetOf(left.weaponId));
  const rightPricing = usePurchaseContext(right.weaponId, presetOf(right.weaponId));
  const leftStats = computeStats(left.root, items, priceSources, ammoFor(left), leftPricing);
  const rightStats = computeStats(right.root, items, priceSources, ammoFor(right), rightPricing);
  const deltas = statDeltas(leftStats, rightStats);
  const rows = diffBuildTrees(left.root, right.root, items);
  const changed = rows.filter((row) => row.status !== "same");
  const visible = showSame ? rows : changed;
  const statsLoading = loading && (leftStats.base === null || rightStats.base === null);
  const leftLabel = left.name || "Build A";
  const rightLabel = right.name || "Build B";

  return (
    <>
      <div className="flex items-end gap-2">
        <BuildSelect label="Build A" value={left.id} exclude={right.id} builds={builds} onChange={(id) => onSelect("a", id)} />
        <Button variant="outline" size="icon" className="shrink-0" onClick={onSwap} aria-label="Swap builds" title="Swap builds">
          <ArrowLeftRight />
        </Button>
        <BuildSelect label="Build B" value={right.id} exclude={left.id} builds={builds} onChange={(id) => onSelect("b", id)} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {[left, right].map((build, index) => {
          const weapon = items.get(build.weaponId) ?? byId.get(build.weaponId);
          const parts = countParts(build.root);
          return (
            <Link
              key={build.id}
              href={`/gun-builder/${build.id}`}
              className="group flex min-w-0 flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-2.5 transition-colors hover:border-[#9a8866] sm:flex-row sm:items-center sm:gap-3 sm:p-3"
            >
              <span className="flex h-12 w-full shrink-0 items-center justify-center bg-[#080808] sm:h-14 sm:w-24">
                {weapon?.gridImageLink ? (
                  <Image src={weapon.gridImageLink} alt="" width={96} height={56} className="h-full w-full object-contain p-0.5" />
                ) : (
                  <span className="h-8 w-14 animate-shimmer" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">Build {index === 0 ? "A" : "B"}</span>
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-black uppercase tracking-widest text-[#e6d9b8] group-hover:underline">
                    {build.name || "Untitled build"}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-[#666]" aria-hidden />
                </span>
                <span className="block truncate text-xs text-[#888]">
                  {weapon?.shortName ?? "Weapon"} · {parts} part{parts === 1 ? "" : "s"}
                  <span className="max-sm:hidden"> · {formatDate(build.updatedAt)}</span>
                </span>
                {build.ammoId && (
                  <span className="block truncate text-xs text-[#9a8866]">
                    {ammoItems.get(build.ammoId)?.shortName ?? "Ammo"}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Some part data could not be loaded.
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      <section aria-labelledby="compare-stats" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="compare-stats" className="text-[11px] font-bold uppercase tracking-widest text-[#888]">
            Stats <span className="text-[#555]">· Δ is B minus A · {modeLabel(gameMode)} prices</span>
          </h2>
          <PriceSourcesControl priceSources={priceSources} onChange={setPriceSources} />
        </div>
        <StatDeltaTable rows={deltas} leftLabel={leftLabel} rightLabel={rightLabel} loading={statsLoading} />
      </section>

      <section aria-labelledby="compare-parts" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 id="compare-parts" className="text-[11px] font-bold uppercase tracking-widest text-[#888]">
            Parts <span className="text-[#555]">· {changed.length} difference{changed.length === 1 ? "" : "s"}</span>
          </h2>
          <button
            type="button"
            aria-pressed={showSame}
            onClick={() => setShowSame(!showSame)}
            className="flex h-9 items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
          >
            <span
              aria-hidden
              className={cn(
                "flex h-4 w-7 items-center border p-0.5 transition-colors",
                showSame ? "justify-end border-[#9a8866] bg-[#9a8866]/20" : "justify-start border-[#3a3a3a]"
              )}
            >
              <span className={cn("h-2.5 w-2.5", showSame ? "bg-[#e6d9b8]" : "bg-[#555]")} />
            </span>
            Show identical
          </button>
        </div>
        {visible.length > 0 ? (
          <DiffList rows={visible} lookup={items} leftLabel={leftLabel} rightLabel={rightLabel} links />
        ) : (
          <p className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">
            {loading ? "Loading parts…" : "These builds use exactly the same parts."}
          </p>
        )}
      </section>
    </>
  );
}
