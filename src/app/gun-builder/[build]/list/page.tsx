"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, ClipboardCopy, Printer } from "lucide-react";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import { useHydrated } from "@/app/lib/storage/use-store";
import { findBuild, setPriceSources, useBuilds, usePriceSources } from "@/app/lib/builds/store";
import { collectItemIds } from "@/app/lib/builds/tree";
import { buildShoppingList, formatShoppingList } from "@/app/lib/builds/shopping";
import { useAmmoItems, useGunItems, useGunList } from "@/app/lib/cache/gunBuilderHooks";
import { effectivePrice } from "@/app/lib/builds/price";
import { itemHref } from "@/app/lib/item-links";
import { copyText } from "@/app/lib/browser/clipboard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalMissing } from "@/components/local-missing";
import { PriceSourcesControl } from "@/app/components/gun-builder/stats-panel";
import { formatRub, formatTrader, modeLabel } from "@/app/components/gun-builder/format";
import { useDocumentTitle } from "@/app/components/gun-builder/use-document-title";
import { cn } from "@/lib/utils";

const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  html, body { background: #fff !important; color: #000 !important; }
  body > a, body > header, header, footer, [data-print-hide] { display: none !important; }
  [data-print-root], [data-print-root] * {
    color: #000 !important;
    background: transparent !important;
    border-color: #bbb !important;
    box-shadow: none !important;
  }
  [data-print-root] img { filter: grayscale(1); }
}
`;

export default function ShoppingListPage() {
  const params = useParams<{ build: string }>();
  const hydrated = useHydrated();
  const build = findBuild(useBuilds(), params.build);

  if (!hydrated) {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }
  if (!build) {
    return <LocalMissing title="Build not found" backHref="/gun-builder" backLabel="Back to builds" />;
  }
  return <ShoppingList key={build.id} build={build} />;
}

function ShoppingList({ build }: { build: GunBuild }) {
  const ids = useMemo(() => collectItemIds(build.root), [build.root]);
  const { items, loading, error, retry, gameMode } = useGunItems(ids, "full");
  const priceSources = usePriceSources();
  const { byId } = useGunList();
  const [includeWeapon, setIncludeWeapon] = useState(true);
  const ammoIds = useMemo(() => (build.ammoId ? [build.ammoId] : []), [build.ammoId]);
  const { items: ammoItems } = useAmmoItems(ammoIds);
  const ammo = build.ammoId ? ammoItems.get(build.ammoId) : undefined;
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useDocumentTitle(`Shopping list · ${build.name || "Untitled build"}`);

  const list = buildShoppingList(build.root, items, priceSources, includeWeapon);
  const weaponName = items.get(build.weaponId)?.name ?? byId.get(build.weaponId)?.name ?? null;
  const noSources = !priceSources.traders && !priceSources.flea;

  async function copy() {
    try {
      await copyText(
        formatShoppingList(list, { buildName: build.name, weaponName, modeLabel: modeLabel(gameMode) })
      );
      setNotice({ ok: true, text: "Copied. Paste it into Discord or any chat." });
    } catch (reason) {
      setNotice({ ok: false, text: reason instanceof Error ? reason.message : "Could not copy the list." });
    }
  }

  return (
    <div data-print-root className="flex w-full max-w-4xl flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <Link
        data-print-hide
        href={`/gun-builder/${build.id}`}
        className="inline-flex h-6 w-fit items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to build
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a8866]">Shopping list</p>
          <h1 className="truncate text-xl font-black uppercase tracking-widest text-[#e6d9b8] sm:text-2xl">
            {build.name || "Untitled build"}
          </h1>
          <p className="truncate text-xs text-[#888]">
            {weaponName ?? "Loading weapon…"} · {modeLabel(gameMode)} prices
          </p>
        </div>
        <div data-print-hide className="flex gap-2 max-sm:[&>*]:flex-1">
          <Button onClick={() => void copy()} disabled={loading}>
            {notice?.ok ? <Check /> : <ClipboardCopy />} Copy for Discord
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={loading}>
            <Printer /> Print
          </Button>
        </div>
      </div>

      <div data-print-hide className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-[#1a1a1a] bg-[#0c0c0c] px-3 py-2">
        <PriceSourcesControl priceSources={priceSources} onChange={setPriceSources} />
        <button
          type="button"
          aria-pressed={includeWeapon}
          onClick={() => setIncludeWeapon(!includeWeapon)}
          className="flex h-9 items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
        >
          <span
            aria-hidden
            className={cn(
              "flex h-4 w-7 items-center border p-0.5 transition-colors",
              includeWeapon ? "justify-end border-[#9a8866] bg-[#9a8866]/20" : "justify-start border-[#3a3a3a]"
            )}
          >
            <span className={cn("h-2.5 w-2.5", includeWeapon ? "bg-[#e6d9b8]" : "bg-[#555]")} />
          </span>
          Include weapon
        </button>
      </div>

      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          data-print-hide
          className={cn(
            "border px-3 py-2 text-sm",
            notice.ok ? "border-[#3a3326] bg-[#0f0d0a] text-[#e6d9b8]" : "border-red-900/60 bg-red-950/30 text-red-200"
          )}
        >
          {notice.text}
        </p>
      )}
      {error && (
        <div role="alert" data-print-hide className="flex items-center justify-between gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Some part prices could not be loaded.
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      <div className="border border-[#1a1a1a] bg-[#0c0c0c]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
              <th scope="col" className="px-3 py-2 text-left font-bold">Part</th>
              <th scope="col" className="hidden w-12 px-2 py-2 text-right font-bold sm:table-cell">Qty</th>
              <th scope="col" className="hidden w-32 px-2 py-2 text-right font-bold sm:table-cell">Trader</th>
              <th scope="col" className="hidden w-28 px-2 py-2 text-right font-bold sm:table-cell">Flea</th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-bold">Best</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.rows.every((row) => !row.unitPriceRUB)
              ? Array.from({ length: 6 }, (_, index) => (
                  <tr key={index} className="border-t border-[#161616]">
                    <td colSpan={5} className="px-3 py-2.5">
                      <span className="block h-8 w-full animate-shimmer" />
                    </td>
                  </tr>
                ))
              : list.rows.map((row) => {
                  const item = items.get(row.itemId);
                  return (
                    <tr key={row.itemId} className="border-t border-[#161616] align-middle">
                      <td className="px-3 py-2">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-12 shrink-0 items-center justify-center bg-[#050505]">
                            {item?.gridImageLink && (
                              <Image src={item.gridImageLink} alt="" width={48} height={36} className="h-full w-full object-contain p-0.5" />
                            )}
                          </span>
                          <span className="min-w-0">
                            {item ? (
                              <Link
                                href={itemHref({ name: row.name, normalizedName: row.normalizedName })}
                                prefetch={false}
                                className="line-clamp-2 text-sm font-semibold text-[#ddd] hover:text-[#e6d9b8] hover:underline"
                              >
                                {row.name}
                              </Link>
                            ) : (
                              <span className="text-sm text-[#888]">{row.name}</span>
                            )}
                            <span className="flex flex-wrap gap-x-3 text-[11px] tabular-nums text-[#777] sm:hidden">
                              {row.count > 1 && <span>×{row.count}</span>}
                              <span className={cn(row.source === "trader" && "text-[#c8b384]")}>
                                Trader {formatRub(row.traderPriceRUB)}
                                {row.traderName ? ` · ${row.traderName}${row.traderLevel ? ` LL${row.traderLevel}` : ""}` : ""}
                              </span>
                              <span className={cn(row.source === "flea" && "text-[#c8b384]")}>Flea {formatRub(row.fleaPriceRUB)}</span>
                            </span>
                            {row.isWeapon && (
                              <span className="hidden text-[10px] font-bold uppercase tracking-widest text-[#9a8866] sm:block">Weapon</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums text-[#ccc] sm:table-cell">{row.count}</td>
                      <td
                        className={cn(
                          "hidden px-2 py-2 text-right tabular-nums sm:table-cell",
                          row.source === "trader" ? "font-bold text-[#e6d9b8]" : "text-[#888]"
                        )}
                      >
                        {formatRub(row.traderPriceRUB)}
                        {row.traderName && (
                          <span className="block text-[10px] font-normal text-[#9a8866]">
                            {row.traderName}
                            {row.traderLevel ? ` LL${row.traderLevel}` : ""}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "hidden px-2 py-2 text-right tabular-nums sm:table-cell",
                          row.source === "flea" ? "font-bold text-[#e6d9b8]" : "text-[#888]"
                        )}
                      >
                        {formatRub(row.fleaPriceRUB)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="block font-black text-[#e6d9b8]">{formatRub(row.subtotalRUB)}</span>
                        <span className="block text-[10px] uppercase tracking-widest text-[#666]">
                          {row.source ?? (noSources ? "no source" : "no price")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#2a2a2a] bg-[#0f0d0a]">
              <th scope="row" colSpan={1} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-[#aaa]">
                Total · {list.itemCount} item{list.itemCount === 1 ? "" : "s"}
                {list.unpricedCount > 0 && (
                  <span className="block text-[10px] font-normal normal-case tracking-normal text-[#c8b384]">
                    {list.unpricedCount} without a price from the selected sources
                  </span>
                )}
              </th>
              <td colSpan={3} className="hidden sm:table-cell" />
              <td className="px-3 py-3 text-right text-base font-black tabular-nums text-[#e6d9b8]">
                {noSources ? "—" : formatRub(list.totalRUB)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {ammo && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[#1a1a1a] bg-[#0c0c0c] px-3 py-2 text-sm">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#888]">Ammo</span>
          <Link href={itemHref(ammo)} prefetch={false} className="min-w-0 truncate font-semibold text-[#ddd] hover:text-[#e6d9b8] hover:underline">
            {ammo.name}
          </Link>
          <span className="tabular-nums text-[#ccc]">{formatRub(effectivePrice(ammo, priceSources))} per round</span>
          {formatTrader(ammo) && <span className="text-xs text-[#9a8866]">{formatTrader(ammo)}</span>}
          <span className="text-xs text-[#666]">Not included in the total</span>
        </p>
      )}
      <p className="text-xs text-[#666]">
        Best uses the cheaper of your selected sources. Prices refresh every 15 minutes.
      </p>
    </div>
  );
}
