"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, Check, Crosshair, LoaderCircle, Search, X } from "lucide-react";
import type { AmmoItemData, PriceSources } from "@/app/lib/types/gunBuilder";
import type { AmmoOptions } from "@/app/lib/builds/ammo";
import { useAmmoItems } from "@/app/lib/cache/gunBuilderHooks";
import { itemHref } from "@/app/lib/item-links";
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
import { formatRecoilModifier, formatRub, shownPrice } from "./format";
import { PriceSource } from "./price-source";

type SortKey = "name" | "penetration" | "damage" | "armor" | "recoil" | "price";

const SORTS: { key: SortKey; label: string; descending: boolean }[] = [
  { key: "penetration", label: "Pen", descending: true },
  { key: "damage", label: "Dmg", descending: true },
  { key: "armor", label: "Armor", descending: true },
  { key: "recoil", label: "Recoil", descending: false },
  { key: "price", label: "Price", descending: false },
  { key: "name", label: "Name", descending: false },
];

function sortValue(ammo: AmmoItemData, key: SortKey, price: number | null) {
  if (key === "penetration") return ammo.penetrationPower;
  if (key === "damage") return ammo.damage * ammo.projectileCount;
  if (key === "armor") return ammo.armorDamage;
  if (key === "recoil") return ammo.recoilModifier;
  if (key === "price") return price;
  return null;
}

function penetrationTone(value: number) {
  if (value >= 50) return "text-emerald-300";
  if (value >= 40) return "text-lime-300";
  if (value >= 30) return "text-[#e6d9b8]";
  if (value >= 20) return "text-amber-300";
  return "text-red-300";
}

export function formatDamage(ammo: AmmoItemData) {
  return ammo.projectileCount > 1 ? `${ammo.damage}×${ammo.projectileCount}` : String(ammo.damage);
}

function AmmoThumb({ ammo, size = "md" }: { ammo: AmmoItemData | undefined; size?: "sm" | "md" }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center bg-[#050505]", size === "md" ? "h-10 w-10" : "h-8 w-8")}>
      {ammo?.gridImageLink && (
        <Image src={ammo.gridImageLink} alt="" width={40} height={40} className="h-full w-full object-contain p-0.5" />
      )}
    </span>
  );
}

export function AmmoPanel({
  ammo,
  ammoId,
  options,
  loading,
  priceSources,
  onOpen,
  onClear,
}: {
  ammo: AmmoItemData | undefined;
  ammoId: string | null;
  options: AmmoOptions;
  loading: boolean;
  priceSources: PriceSources;
  onOpen: () => void;
  onClear: () => void;
}) {
  if (options.ids.length === 0 && !ammoId) return null;
  const fits = Boolean(ammoId && options.ids.includes(ammoId));
  const shown = ammo ? shownPrice(ammo, priceSources) : null;
  const price = shown?.price ?? null;
  return (
    <section aria-label="Ammo" className="flex items-stretch border border-[#1a1a1a] bg-[#0c0c0c]">
      <button
        type="button"
        onClick={onOpen}
        disabled={options.ids.length === 0}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#101010] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8] disabled:cursor-default"
        aria-label={ammo ? `Ammo: ${ammo.name}. Change ammo` : "Choose ammo"}
      >
        <span className="hidden w-14 shrink-0 text-[10px] font-bold uppercase tracking-widest text-[#888] sm:block">Ammo</span>
        {ammoId ? (
          <>
            {ammo ? <AmmoThumb ammo={ammo} /> : <span className="h-10 w-10 shrink-0 animate-shimmer" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-[#ddd]">
                {ammo?.name ?? (loading ? "Loading ammo…" : "Unavailable ammo")}
              </span>
              {ammo && (
                <span className="flex flex-wrap gap-x-3 text-[11px] tabular-nums text-[#888]">
                  <span>
                    Pen <b className={cn("font-bold", penetrationTone(ammo.penetrationPower))}>{ammo.penetrationPower}</b>
                  </span>
                  <span>
                    Dmg <b className="font-bold text-[#ccc]">{formatDamage(ammo)}</b>
                  </span>
                  {ammo.recoilModifier !== 0 && <span>Recoil {formatRecoilModifier(ammo.recoilModifier)}</span>}
                  <span className="text-[#ccc]">{price === null ? "No price" : `${formatRub(price)}/round`}</span>
                  {shown && <PriceSource shown={shown} />}
                </span>
              )}
              {!fits && ammo && options.ids.length > 0 && (
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Doesn&apos;t fit the installed {options.source === "magazine" ? "magazine" : "weapon"}; not counted in stats
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[#888]">
            <Crosshair className="h-4 w-4 shrink-0 text-[#9a8866]" />
            Choose ammo
            <span className="truncate text-xs text-[#666]">· {options.ids.length} compatible</span>
          </span>
        )}
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
          {ammoId ? "Change" : "Select"}
        </span>
      </button>
      {ammoId && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear ammo"
          title="Clear ammo"
          className="flex w-10 shrink-0 items-center justify-center border-l border-[#1a1a1a] text-[#666] transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-red-300"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </section>
  );
}

export function AmmoPicker({
  open,
  options,
  selectedId,
  priceSources,
  onClose,
  onSelect,
}: {
  open: boolean;
  options: AmmoOptions;
  selectedId: string | null;
  priceSources: PriceSources;
  onClose: () => void;
  onSelect: (ammoId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[min(88dvh,760px)] max-w-3xl flex-col gap-3 p-4 sm:p-5">
        {open && <AmmoPickerBody options={options} selectedId={selectedId} priceSources={priceSources} onSelect={onSelect} />}
      </DialogContent>
    </Dialog>
  );
}

function AmmoPickerBody({
  options,
  selectedId,
  priceSources,
  onSelect,
}: {
  options: AmmoOptions;
  selectedId: string | null;
  priceSources: PriceSources;
  onSelect: (ammoId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "penetration", descending: true });
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { items, loading, error, retry } = useAmmoItems(options.ids);
  const phrase = search.trim().toLowerCase();
  const rows = options.ids
    .flatMap((id) => {
      const ammo = items.get(id);
      if (!ammo) return [];
      const shown = shownPrice(ammo, priceSources);
      return [{ ammo, price: shown.price, shown }];
    })
    .filter(
      ({ ammo }) =>
        !phrase || ammo.name.toLowerCase().includes(phrase) || ammo.shortName.toLowerCase().includes(phrase)
    )
    .sort((a, b) => {
      const direction = sort.descending ? -1 : 1;
      if (sort.key === "name") return a.ammo.name.localeCompare(b.ammo.name) * direction;
      const left = sortValue(a.ammo, sort.key, a.price);
      const right = sortValue(b.ammo, sort.key, b.price);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return (left - right) * direction || a.ammo.name.localeCompare(b.ammo.name);
    });
  const showSkeleton = rows.length === 0 && loading;
  const selected = selectedId ? items.get(selectedId) : undefined;

  function moveFocus(event: React.KeyboardEvent<HTMLElement>) {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-ammo]") ?? []);
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLElement | undefined;
    if (event.key === "ArrowDown") next = buttons[Math.min(buttons.length - 1, index + 1)];
    else if (event.key === "ArrowUp") next = index <= 0 ? (searchRef.current ?? undefined) : buttons[index - 1];
    else if (event.key === "Home" && index !== -1) next = buttons[0];
    else if (event.key === "End" && index !== -1) next = buttons[buttons.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  return (
    <>
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">Ammo</DialogTitle>
        <DialogDescription className="text-xs">
          {options.ids.length} type{options.ids.length === 1 ? "" : "s"} fit the installed{" "}
          {options.source === "magazine" ? "magazine" : "weapon"}. Ammo recoil is added to the build&apos;s recoil.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" />
          <Input
            ref={searchRef}
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && rows[0]) {
                event.preventDefault();
                onSelect(rows[0].ammo.id);
              } else if (event.key === "ArrowDown") {
                moveFocus(event);
              }
            }}
            placeholder="Search ammo"
            aria-label="Search ammo"
            aria-describedby="ammo-keys"
          />
        </div>
        <div role="group" aria-label="Sort ammo" className="grid shrink-0 grid-cols-6 border border-[#2a2a2a]">
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
                      : { key: option.key, descending: option.descending }
                  )
                }
                className={cn(
                  "flex h-10 items-center justify-center gap-0.5 px-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] sm:px-2.5 sm:tracking-widest",
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

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Could not load ammo.
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      <div className="hidden grid-cols-[2rem_minmax(0,1fr)_3.5rem_3rem_3.5rem_3.5rem_6.5rem_1rem] gap-3 px-3 text-[10px] font-bold uppercase tracking-widest text-[#666] sm:grid">
        <span className="col-span-2 flex items-center gap-2">
          {showSkeleton ? "Loading ammo" : `${rows.length} shown`}
          {loading && !showSkeleton && <LoaderCircle className="h-3 w-3 animate-spin text-[#9a8866]" />}
        </span>
        <span className="text-right">Dmg</span>
        <span className="text-right">Pen</span>
        <span className="text-right">Armor</span>
        <span className="text-right">Recoil</span>
        <span className="text-right">Per round</span>
        <span />
      </div>

      <p id="ammo-keys" className="sr-only">
        Press the down arrow to move through ammo types, then Enter to select one.
      </p>
      <ul
        ref={listRef}
        onKeyDown={moveFocus}
        aria-label="Compatible ammo"
        className="min-h-24 flex-1 overflow-y-auto overscroll-contain border border-[#1a1a1a] bg-[#080808]"
      >
        {showSkeleton &&
          Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="flex items-center gap-3 border-t border-[#141414] p-3 first:border-t-0">
              <span className="h-8 w-8 shrink-0 animate-shimmer" />
              <span className="h-4 flex-1 animate-shimmer" />
            </li>
          ))}
        {rows.map(({ ammo, price, shown }) => {
          const current = ammo.id === selectedId;
          return (
            <li key={ammo.id} className="border-t border-[#141414] first:border-t-0">
              <button
                type="button"
                data-ammo
                onClick={() => onSelect(ammo.id)}
                className={cn(
                  "grid w-full grid-cols-[2rem_minmax(0,1fr)_1rem] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#121212] focus-visible:bg-[#121212] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] sm:grid-cols-[2rem_minmax(0,1fr)_3.5rem_3rem_3.5rem_3.5rem_6.5rem_1rem]",
                  current && "bg-[#14110c]"
                )}
              >
                <AmmoThumb ammo={ammo} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#ddd]">{ammo.name}</span>
                  <span className="flex flex-wrap gap-x-3 text-xs tabular-nums text-[#888] sm:hidden">
                    <span>
                      Pen <b className={cn("font-bold", penetrationTone(ammo.penetrationPower))}>{ammo.penetrationPower}</b>
                    </span>
                    <span>Dmg {formatDamage(ammo)}</span>
                    <span>Armor {ammo.armorDamage}</span>
                    {ammo.recoilModifier !== 0 && <span>{formatRecoilModifier(ammo.recoilModifier)}</span>}
                    <span className={price === null ? "text-[#666]" : "text-[#ccc]"}>
                      {price === null ? "No price" : formatRub(price)}
                    </span>
                    <PriceSource shown={shown} />
                  </span>
                </span>
                <span className="hidden text-right text-xs tabular-nums text-[#ccc] sm:block">{formatDamage(ammo)}</span>
                <span className={cn("hidden text-right text-xs font-bold tabular-nums sm:block", penetrationTone(ammo.penetrationPower))}>
                  {ammo.penetrationPower}
                </span>
                <span className="hidden text-right text-xs tabular-nums text-[#888] sm:block">{ammo.armorDamage}</span>
                <span
                  className={cn(
                    "hidden text-right text-xs tabular-nums sm:block",
                    ammo.recoilModifier < 0 ? "text-emerald-300" : ammo.recoilModifier > 0 ? "text-red-300" : "text-[#888]"
                  )}
                >
                  {formatRecoilModifier(ammo.recoilModifier)}
                </span>
                <span className="hidden flex-col items-end text-xs tabular-nums sm:flex">
                  <span className="text-[#ccc]">{formatRub(price)}</span>
                  <PriceSource shown={shown} className="max-w-full text-[10px]" lockClassName="h-2.5 w-2.5" />
                </span>
                {current ? <Check className="h-4 w-4 text-[#9a8866]" /> : <span />}
              </button>
            </li>
          );
        })}
        {!showSkeleton && rows.length === 0 && (
          <li className="p-6 text-center text-sm text-[#888]">
            {phrase ? "No ammo matches this search." : error ? "Ammo could not be loaded." : "No ammo data for this weapon."}
          </li>
        )}
      </ul>

      {selected && (
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <Link href={itemHref(selected)} prefetch={false}>
              <ArrowUpRight /> View {selected.shortName}
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}
