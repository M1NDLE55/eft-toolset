"use client";

import Image from "next/image";
import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, LoaderCircle, Search, Trash2 } from "lucide-react";
import type { BuildNode, GunItem, ModSlotDef, PriceSources } from "@/app/lib/types/gunBuilder";
import type { ItemLookup } from "@/app/lib/builds/stats";
import { effectivePrice } from "@/app/lib/builds/price";
import { nodeAt } from "@/app/lib/builds/tree";
import { useGunItems } from "@/app/lib/cache/gunBuilderHooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatErgo, formatRecoilModifier, formatRub } from "./format";

export interface PickerTarget {
  parentPath: string[];
  slotId: string;
  slot: ModSlotDef;
  currentItemId: string | null;
  parentItemId: string | null;
  container: HTMLElement | null;
}

type SortKey = "name" | "ergo" | "recoil" | "price";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "ergo", label: "Ergo" },
  { key: "recoil", label: "Recoil" },
  { key: "price", label: "Price" },
];

const EMPTY_IDS: string[] = [];

interface Candidate {
  item: GunItem;
  price: number | null;
  reason: string | null;
}

function installedOutside(root: BuildNode, excluded: BuildNode | undefined) {
  const items: string[] = [root.itemId];
  const slots = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const [slotId, child] of Object.entries(node.slots)) {
      if (child === excluded) continue;
      slots.add(slotId);
      items.push(child.itemId);
      stack.push(child);
    }
  }
  return { items, itemSet: new Set(items), slots };
}

function conflictReason(
  candidate: GunItem,
  slotId: string,
  installed: ReturnType<typeof installedOutside>,
  lookup: ItemLookup
) {
  const own = candidate.conflictingItemIds.find((id) => installed.itemSet.has(id));
  if (own) return `Conflicts with ${lookup.get(own)?.shortName ?? "an installed part"}`;
  for (const id of installed.items) {
    const other = lookup.get(id);
    if (!other) continue;
    if (other.conflictingItemIds.includes(candidate.id)) return `Conflicts with ${other.shortName}`;
    if (other.conflictingSlotIds.includes(slotId)) return `Blocked by ${other.shortName}`;
  }
  if (candidate.conflictingSlotIds.some((id) => installed.slots.has(id))) {
    return "Blocks an occupied slot";
  }
  return null;
}

function compare(a: Candidate, b: Candidate, key: SortKey, descending: boolean) {
  const direction = descending ? -1 : 1;
  if (key === "name") return a.item.name.localeCompare(b.item.name) * direction;
  const value = (candidate: Candidate) =>
    key === "ergo"
      ? candidate.item.ergonomics
      : key === "recoil"
        ? candidate.item.recoilModifier
        : candidate.price;
  const left = value(a);
  const right = value(b);
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

export function SlotPicker({
  target,
  root,
  lookup,
  priceSources,
  onClose,
  onSelect,
  onRemove,
}: {
  target: PickerTarget | null;
  root: BuildNode;
  lookup: ItemLookup;
  priceSources: PriceSources;
  onClose: () => void;
  onSelect: (itemId: string) => Promise<void>;
  onRemove: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        portalContainer={target?.container}
        className="flex h-[min(88dvh,760px)] max-w-3xl flex-col gap-3 p-4 sm:p-5"
      >
        {target && (
          <PickerBody
            key={`${target.parentPath.join("/")}/${target.slotId}`}
            target={target}
            root={root}
            lookup={lookup}
            priceSources={priceSources}
            onSelect={onSelect}
            onRemove={onRemove}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  target,
  root,
  lookup,
  priceSources,
  onSelect,
  onRemove,
}: {
  target: PickerTarget;
  root: BuildNode;
  lookup: ItemLookup;
  priceSources: PriceSources;
  onSelect: (itemId: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "name", descending: false });
  const [applying, setApplying] = useState<string | null>(null);
  const [applyError, setApplyError] = useState("");
  const allowed = target.slot.allowedItemIds ?? EMPTY_IDS;
  const { items, loading, error, retry } = useGunItems(allowed, "basic");
  const parentName = target.parentItemId ? lookup.get(target.parentItemId)?.shortName : null;

  const installed = installedOutside(root, nodeAt(root, [...target.parentPath, target.slotId]));
  const phrase = search.trim().toLowerCase();
  const candidates: Candidate[] = allowed
    .flatMap((id) => {
      const item = items.get(id);
      return item ? [item] : [];
    })
    .filter(
      (item) =>
        !phrase ||
        item.name.toLowerCase().includes(phrase) ||
        item.shortName.toLowerCase().includes(phrase)
    )
    .map((item) => ({
      item,
      price: effectivePrice(item, priceSources),
      reason: item.id === target.currentItemId ? null : conflictReason(item, target.slotId, installed, lookup),
    }))
    .sort((a, b) => {
      if (Boolean(a.reason) !== Boolean(b.reason)) return a.reason ? 1 : -1;
      return compare(a, b, sort.key, sort.descending);
    });
  const available = candidates.filter((candidate) => !candidate.reason).length;
  const showSkeleton = candidates.length === 0 && loading;

  async function choose(itemId: string) {
    if (applying) return;
    setApplying(itemId);
    setApplyError("");
    try {
      await onSelect(itemId);
    } catch (reason) {
      setApplyError(reason instanceof Error ? reason.message : "Could not add this part.");
      setApplying(null);
    }
  }

  return (
    <>
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">
          {target.slot.name}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {parentName ? `Slot on ${parentName}` : "Weapon slot"}
          {target.slot.required ? " · required" : ""}
          {allowed.length > 0 ? ` · ${allowed.length} compatible part${allowed.length === 1 ? "" : "s"}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              const first = candidates.find((candidate) => !candidate.reason);
              if (event.key === "Enter" && first) {
                event.preventDefault();
                void choose(first.item.id);
              }
            }}
            placeholder="Search parts"
            aria-label="Search compatible parts"
            enterKeyHint="go"
          />
        </div>
        <div role="group" aria-label="Sort parts" className="flex shrink-0 border border-[#2a2a2a]">
          {SORTS.map((option) => {
            const active = sort.key === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setSort((current) =>
                    current.key === option.key
                      ? { key: option.key, descending: !current.descending }
                      : { key: option.key, descending: option.key === "ergo" }
                  )
                }
                className={cn(
                  "flex h-10 flex-1 items-center justify-center gap-1 px-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] sm:flex-none",
                  active ? "bg-[#1a1712] text-[#e6d9b8]" : "text-[#888] hover:text-[#ccc]"
                )}
              >
                {option.label}
                {active && (sort.descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
              </button>
            );
          })}
        </div>
      </div>

      {(error || applyError) && (
        <div role="alert" className="flex items-center justify-between gap-3 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {applyError || "Could not load compatible parts."}
          </span>
          {error && !applyError && (
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[#666]">
        <span aria-live="polite">
          {showSkeleton ? "Loading parts" : `${available} available${candidates.length > available ? ` · ${candidates.length - available} blocked` : ""}`}
        </span>
        {loading && !showSkeleton && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#9a8866]" />}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain border border-[#1a1a1a] bg-[#080808]">
        {showSkeleton &&
          Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="flex items-center gap-3 border-t border-[#141414] p-3 first:border-t-0">
              <span className="h-10 w-14 shrink-0 animate-shimmer" />
              <span className="h-4 flex-1 animate-shimmer" />
            </li>
          ))}
        {candidates.map(({ item, price, reason }) => {
          const current = item.id === target.currentItemId;
          return (
            <li key={item.id} className="border-t border-[#141414] first:border-t-0">
              <button
                type="button"
                disabled={Boolean(reason) || Boolean(applying)}
                onClick={() => void choose(item.id)}
                aria-describedby={reason ? `reason-${item.id}` : undefined}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#121212] focus-visible:bg-[#121212] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] disabled:cursor-not-allowed",
                  reason && "opacity-45",
                  current && "bg-[#14110c]"
                )}
              >
                <span className="flex h-10 w-14 shrink-0 items-center justify-center bg-[#050505]">
                  {item.gridImageLink && (
                    <Image src={item.gridImageLink} alt="" width={56} height={40} className="h-full w-full object-contain p-0.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[#ddd]">{item.name}</span>
                    {current && (
                      <span className="shrink-0 border border-[#9a8866] px-1 text-[9px] font-bold uppercase tracking-widest text-[#e6d9b8]">
                        Installed
                      </span>
                    )}
                  </span>
                  {reason ? (
                    <span id={`reason-${item.id}`} className="mt-0.5 flex items-center gap-1 text-xs text-amber-300">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {reason}
                    </span>
                  ) : (
                    <span className="mt-0.5 flex gap-3 text-xs tabular-nums text-[#888] sm:hidden">
                      <span>{formatErgo(item.ergonomics)} ergo</span>
                      <span>{formatRecoilModifier(item.recoilModifier)}</span>
                      <span>{formatRub(price)}</span>
                    </span>
                  )}
                </span>
                <span className="hidden shrink-0 items-center gap-4 text-xs tabular-nums sm:flex">
                  <span className={cn("w-12 text-right", item.ergonomics > 0 ? "text-emerald-300" : item.ergonomics < 0 ? "text-red-300" : "text-[#888]")}>
                    {formatErgo(item.ergonomics)}
                  </span>
                  <span className={cn("w-14 text-right", item.recoilModifier < 0 ? "text-emerald-300" : item.recoilModifier > 0 ? "text-red-300" : "text-[#888]")}>
                    {formatRecoilModifier(item.recoilModifier)}
                  </span>
                  <span className="w-24 text-right text-[#ccc]">{formatRub(price)}</span>
                </span>
                {applying === item.id ? (
                  <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[#9a8866]" />
                ) : current ? (
                  <Check className="h-4 w-4 shrink-0 text-[#9a8866]" />
                ) : null}
              </button>
            </li>
          );
        })}
        {!showSkeleton && candidates.length === 0 && (
          <li className="p-6 text-center text-sm text-[#888]">
            {phrase ? "No compatible parts match this search." : error ? "Parts could not be loaded." : "No compatible parts for this slot."}
          </li>
        )}
      </ul>

      {target.currentItemId && (
        <div className="flex justify-end">
          <Button variant="outline" className="text-red-300 hover:text-red-200" onClick={onRemove}>
            <Trash2 /> Remove part
          </Button>
        </div>
      )}
    </>
  );
}
