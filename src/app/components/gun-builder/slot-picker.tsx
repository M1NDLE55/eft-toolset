"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, Search } from "lucide-react";
import type {
  BuildItemData,
  ModSlotDef,
  PickItemData,
  PriceSources,
} from "@/app/lib/types/gunBuilder";
import type { GameMode } from "@/components/game-mode/context";
import { fetchPickItems } from "@/app/lib/cache/gunBuilder";
import { effectivePrice } from "@/app/lib/builds/price";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SlotPickerProps {
  open: boolean;
  slot: ModSlotDef | null;
  currentItemId?: string | null;
  itemData: Map<string, BuildItemData>;
  installedItemIds: string[];
  occupiedSlotIds: string[];
  gameMode: GameMode;
  priceSources: PriceSources;
  portalContainer?: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (itemId: string) => void;
}

function price(item: PickItemData, sources: PriceSources) {
  const value = effectivePrice(item, sources);
  return value === null ? "No price" : `${value.toLocaleString()} RUB`;
}

function recoilLabel(item: PickItemData) {
  if (!item.recoilModifier) return "0% recoil";
  return `${Math.round(item.recoilModifier * 100)}% recoil`;
}

export function SlotPicker({
  open,
  slot,
  currentItemId,
  itemData,
  installedItemIds,
  occupiedSlotIds,
  gameMode,
  priceSources,
  portalContainer,
  onOpenChange,
  onSelect,
}: SlotPickerProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [pickItems, setPickItems] = useState<Map<string, PickItemData>>(
    new Map()
  );

  useEffect(() => {
    if (!open || !slot) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPickItems(slot.allowedItemIds, gameMode)
      .then((fetched) => {
        if (cancelled) return;
        setPickItems(new Map(fetched.map((item) => [item.id, item])));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error("Could not load compatible mods."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slot, gameMode, retryToken]);

  const installedSet = useMemo(
    () => new Set(installedItemIds.filter((id) => id !== currentItemId)),
    [installedItemIds, currentItemId]
  );
  const occupiedSet = useMemo(
    () => new Set(occupiedSlotIds.filter((id) => id !== slot?.id)),
    [occupiedSlotIds, slot]
  );

  const candidates = useMemo(() => {
    if (!slot) return [];
    const phrase = search.trim().toLowerCase();

    return slot.allowedItemIds
      .map((id) => pickItems.get(id))
      .filter((item): item is PickItemData => Boolean(item))
      .filter(
        (item) =>
          !phrase ||
          item.name.toLowerCase().includes(phrase) ||
          item.shortName.toLowerCase().includes(phrase)
      )
      .slice(0, 80)
      .map((item) => {
        const conflictsWithInstalled = Array.from(installedSet).some((installedId) => {
          const installed = itemData.get(installedId);
          return (
            installed?.conflictingItemIds.includes(item.id) ||
            item.conflictingItemIds.includes(installedId)
          );
        });
        const slotConflict = item.conflictingSlotIds.some((slotId) =>
          occupiedSet.has(slotId)
        );
        const alreadyInstalled = installedSet.has(item.id);

        return {
          item,
          disabled: conflictsWithInstalled || slotConflict || alreadyInstalled,
          reason: alreadyInstalled
            ? "Already installed"
            : conflictsWithInstalled
              ? "Conflicts with installed item"
              : slotConflict
                ? "Conflicts with an occupied slot"
                : null,
        };
      });
  }, [slot, search, pickItems, itemData, installedSet, occupiedSet]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] max-w-3xl overflow-hidden"
        portalContainer={portalContainer}
      >
        <DialogHeader>
          <DialogTitle>{slot ? `Fill ${slot.name}` : "Choose mod"}</DialogTitle>
          <DialogDescription>
            Compatible items are loaded for this slot.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#888]" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search compatible mods"
          />
          {loading && (
            <LoaderCircle className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-[#9a8866]" />
          )}
        </div>
        {error && (
          <div className="flex items-center justify-between gap-3 border border-red-900/60 p-3 text-sm text-red-300">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Could not load compatible mods.
            </span>
            <Button size="sm" variant="outline" onClick={() => setRetryToken((value) => value + 1)}>
              Retry
            </Button>
          </div>
        )}
        <div className="max-h-[56vh] overflow-auto border border-[#1a1a1a]">
          {candidates.map(({ item, disabled, reason }) => (
            <button
              type="button"
              key={item.id}
              disabled={disabled}
              title={reason ?? item.name}
              onClick={() => onSelect(item.id)}
              className="flex w-full items-center gap-3 border-b border-[#121212] p-3 text-left transition-colors last:border-b-0 hover:bg-[#111] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="flex h-12 w-16 shrink-0 items-center justify-center bg-[#050505]">
                {item.gridImageLink && (
                  <Image
                    src={item.gridImageLink}
                    alt=""
                    width={64}
                    height={48}
                    className="max-h-11 w-auto object-contain"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[#ccc]">
                  {item.name}
                </p>
                <p className="truncate text-xs text-[#888]">
                  {item.ergonomics > 0 ? "+" : ""}
                  {item.ergonomics} ergo / {recoilLabel(item)} /{" "}
                  {price(item, priceSources)}
                </p>
              </div>
              {reason && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-[#9a8866]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">{reason}</span>
                </span>
              )}
            </button>
          ))}
          {!loading && !error && candidates.length === 0 && (
            <div className="p-4 text-sm text-[#888]">
              No compatible mods match this search.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
