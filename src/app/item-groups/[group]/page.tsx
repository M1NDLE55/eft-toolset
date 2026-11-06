"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NameDialog } from "@/components/name-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LocalMissing } from "@/components/local-missing";
import { ItemSearch } from "@/app/components/global/search/item-search";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";
import { useCatalog, useItemsInGroup } from "@/app/lib/cache/hooks";
import type { CachedItem, CatalogItem } from "@/app/lib/cache/types";
import { itemHref } from "@/app/lib/item-links";
import { Rubles } from "@/app/lib/currency";
import { bestSell } from "@/app/lib/item-price";
import { useHydrated } from "@/app/lib/storage/use-store";
import { recordPrices, usePriceHistories } from "@/app/lib/price-history";
import { ChangeBadge } from "@/app/components/item/price-trend";
import { useGameMode } from "@/components/game-mode/context";
import {
  addGroupItem,
  deleteGroup,
  findGroup,
  removeGroupItem,
  renameGroup,
  useGroups,
} from "@/app/lib/item-groups/store";
import { MAX_GROUP_ITEMS, MAX_GROUP_NAME_LENGTH } from "@/app/lib/item-groups/limits";
import { cn } from "@/lib/utils";

type SortKey = "order" | "name" | "price" | "slot";

interface Row {
  name: string;
  image: string | null;
  slug: string | null;
  data: CachedItem | undefined;
  price: number | null;
  vendor: string | null;
  perSlot: number | null;
  multiSlot: boolean;
}

function toRow(name: string, catalog: CatalogItem | undefined, data: CachedItem | undefined): Row {
  const best = data ? bestSell(data) : null;
  return {
    name,
    image: data?.gridImageLink ?? catalog?.gridImageLink ?? null,
    slug: data?.normalizedName || catalog?.normalizedName || null,
    data,
    price: best?.price ?? null,
    vendor: best ? (best.flea ? "Flea" : best.vendor) : null,
    perSlot: best && data ? best.price / (data.width * data.height) : null,
    multiSlot: data ? data.width * data.height > 1 : false,
  };
}

function sortRows(rows: Row[], key: SortKey, descending: boolean) {
  if (key === "order") return rows;
  const direction = descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name) * direction;
    const left = key === "price" ? a.price : a.perSlot;
    const right = key === "price" ? b.price : b.perSlot;
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return (left - right) * direction;
  });
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "order", label: "Added" },
  { key: "name", label: "Name" },
  { key: "price", label: "Price" },
  { key: "slot", label: "Per slot" },
];

export default function Page() {
  const router = useRouter();
  const routeName = customDecodeURI(useParams<{ group: string }>().group);
  const groups = useGroups();
  const hydrated = useHydrated();
  const group = findGroup(groups, routeName);
  const names = group?.items ?? [];
  const { items, loading, stale, error, refresh } = useItemsInGroup(names);
  const { itemsByName } = useCatalog();
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "order", descending: false });
  const [actionError, setActionError] = useState("");
  const { gameMode } = useGameMode();
  const [now] = useState(() => Date.now());
  const history = usePriceHistories(gameMode, names, hydrated);

  useEffect(() => {
    if (stale || items.length === 0) return;
    void recordPrices(
      gameMode,
      items.flatMap((item) => {
        const best = bestSell(item);
        return best ? [{ name: item.name, price: best.price }] : [];
      })
    );
  }, [gameMode, items, stale]);

  if (!hydrated) {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!group) {
    return <LocalMissing title="Item group not found" backHref="/item-groups" backLabel="Back to groups" />;
  }

  const run = (action: () => void) => {
    try {
      action();
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save this change.");
    }
  };

  const dataByName = new Map(items.map((item) => [item.name, item]));
  const rows = sortRows(
    names.map((name) => toRow(name, itemsByName.get(name), dataByName.get(name))),
    sort.key,
    sort.descending
  );
  const total = rows.reduce((sum, row) => sum + (row.price ?? 0), 0);

  return (
    <div className="flex w-full max-w-4xl min-w-0 flex-col gap-4">
      <Link
        href="/item-groups"
        className="inline-flex w-fit items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All groups
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="truncate text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">{group.name}</h1>
          <NameDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label="Rename group">
                <Pencil />
              </Button>
            }
            title="Rename group"
            description="Enter a new name for this group."
            initialName={group.name}
            submitLabel="Save"
            maxLength={MAX_GROUP_NAME_LENGTH}
            onSubmit={(name) => router.replace(`/item-groups/${customEncodeURI(renameGroup(group.name, name))}`)}
          />
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="text-red-300 hover:text-red-200">
              <Trash2 /> Delete
            </Button>
          }
          title={`Delete “${group.name}”?`}
          description="This permanently removes the group from this browser."
          confirmLabel="Delete group"
          onConfirm={() =>
            run(() => {
              deleteGroup(group.name);
              router.push("/item-groups");
            })
          }
        />
      </div>

      <ItemSearch
        label="Add items to this group"
        placeholder={names.length >= MAX_GROUP_ITEMS ? "This group is full" : "Add an item…"}
        excludeNames={names}
        keepOpenOnSelect
        onSelect={(item) => run(() => addGroupItem(group.name, item.name))}
      />

      {(actionError || stale || error) && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
        >
          <span>{actionError || (error ? "Prices are temporarily unavailable." : "Showing saved prices while fresh ones load.")}</span>
          {error && !actionError && (
            <button type="button" className="underline" onClick={() => void refresh().catch(() => undefined)}>
              Retry
            </button>
          )}
        </div>
      )}

      {names.length === 0 ? (
        <div className="flex flex-col items-center gap-1 border border-dashed border-[#2a2a2a] p-8 text-center">
          <p className="font-semibold text-[#ccc]">This group is empty</p>
          <p className="text-sm text-[#888]">Search above to add items.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#999]">
              {names.length} item{names.length === 1 ? "" : "s"}
              {total > 0 && (
                <>
                  {" · "}
                  <span className="text-[#e6d9b8] tabular-nums">{Rubles.format(total)}</span> best total
                </>
              )}
            </p>
            <div role="group" aria-label="Sort items" className="flex border border-[#2a2a2a]">
              {SORTS.map((option) => {
                const active = sort.key === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setSort((current) =>
                        current.key === option.key && option.key !== "order"
                          ? { key: option.key, descending: !current.descending }
                          : { key: option.key, descending: option.key === "price" || option.key === "slot" }
                      )
                    }
                    className={cn(
                      "flex h-9 items-center gap-1 px-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                      active ? "bg-[#1a1712] text-[#e6d9b8]" : "text-[#888] hover:text-[#ccc]"
                    )}
                  >
                    {option.label}
                    {active && option.key !== "order" &&
                      (sort.descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </button>
                );
              })}
            </div>
          </div>

          <ul className="border border-[#1a1a1a] bg-[#0c0c0c]">
            {rows.map((row) => (
              <li key={row.name} className="flex items-center gap-3 border-t border-[#1a1a1a] px-3 py-2 first:border-t-0">
                {row.image ? (
                  <Image src={row.image} alt="" width={40} height={40} className="h-10 w-10 shrink-0 bg-[#111] object-contain" />
                ) : (
                  <span className="h-10 w-10 shrink-0 bg-[#111]" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                  <Link
                    href={itemHref({ name: row.name, normalizedName: row.slug })}
                    className="min-w-0 flex-1 truncate text-sm text-[#ddd] hover:text-[#e6d9b8] hover:underline"
                  >
                    {row.name}
                  </Link>
                  <div className="flex items-center gap-3 text-xs tabular-nums sm:text-sm">
                    {row.data ? (
                      <>
                        <span className="text-[#e6d9b8] sm:w-28 sm:text-right" title={row.vendor ?? undefined}>
                          {row.price !== null ? Rubles.format(row.price) : "No buyer"}
                          {row.vendor && <span className="ml-1 text-[10px] uppercase text-[#777]">{row.vendor}</span>}
                          <span className="ml-1.5">
                            <ChangeBadge points={history(row.name)} price={row.price} now={now} />
                          </span>
                        </span>
                        <span className="text-[#888] sm:w-24 sm:text-right">
                          {row.perSlot !== null && row.multiSlot ? `${Rubles.format(row.perSlot)}/slot` : ""}
                        </span>
                      </>
                    ) : loading || !error ? (
                      <Skeleton className="h-4 w-32" />
                    ) : (
                      <span className="text-[#777]">Unavailable</span>
                    )}
                  </div>
                </div>
                {row.data?.wikiLink && (
                  <a
                    href={row.data.wikiLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open the wiki for ${row.name}`}
                    className="hidden h-9 w-9 shrink-0 items-center justify-center text-[#888] hover:text-[#d4b86a] sm:flex"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${row.name}`}
                  onClick={() => run(() => removeGroupItem(group.name, row.name))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center text-[#777] transition-colors hover:text-red-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
