"use client";

import Image from "next/image";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Search } from "lucide-react";
import { useGameMode } from "@/components/game-mode/context";
import type { GunListItem } from "@/app/lib/types/gunBuilder";
import { useGunList } from "@/app/lib/cache/gunBuilderHooks";
import { ensureGunItems, loadPresetTree, prefetchPreset } from "@/app/lib/cache/gunBuilder";
import { createBuild } from "@/app/lib/builds/store";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const INTENT_DELAY_MS = 120;

export function NewBuildDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex h-[min(88dvh,780px)] max-w-2xl flex-col gap-3 p-4 sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">
            New build
          </DialogTitle>
          <DialogDescription>
            Pick a weapon. Start from its factory configuration or from the bare receiver.
          </DialogDescription>
        </DialogHeader>
        {open && <WeaponPicker />}
      </DialogContent>
    </Dialog>
  );
}

function WeaponPicker() {
  const router = useRouter();
  const { gameMode } = useGameMode();
  const { guns, loading, error, retry } = useGunList();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");
  const intent = useRef<number | undefined>(undefined);

  const phrase = search.trim().toLowerCase();
  const filtered = phrase
    ? guns.filter(
        (gun) => gun.name.toLowerCase().includes(phrase) || gun.shortName.toLowerCase().includes(phrase)
      )
    : guns;

  function prefetch(gun: GunListItem, delay: number) {
    window.clearTimeout(intent.current);
    if (!gun.defaultPresetId) return;
    const presetId = gun.defaultPresetId;
    intent.current = window.setTimeout(() => prefetchPreset(presetId, gun.id, gameMode), delay);
  }

  async function create(gun: GunListItem, factory: boolean) {
    if (creating) return;
    setCreating(`${gun.id}:${factory ? "factory" : "empty"}`);
    setCreateError("");
    try {
      const [root] = await Promise.all([
        factory && gun.defaultPresetId ? loadPresetTree(gun.defaultPresetId, gun.id, gameMode) : null,
        ensureGunItems([gun.id], gameMode, "full"),
      ]);
      const build = createBuild(name.trim() || gun.name.slice(0, MAX_BUILD_NAME_LENGTH), gun.id, root ?? undefined);
      router.push(`/gun-builder/${build.id}`);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "Could not create this build.");
      setCreating(null);
    }
  }

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filtered.length === 1) {
                event.preventDefault();
                void create(filtered[0], Boolean(filtered[0].defaultPresetId));
              }
            }}
            placeholder="Search weapons"
            aria-label="Search weapons"
            autoFocus
          />
        </div>
        <Input
          value={name}
          maxLength={MAX_BUILD_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder="Build name (optional)"
          aria-label="Build name"
        />
      </div>

      {(error || createError) && (
        <div role="alert" className="flex items-center justify-between gap-3 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {createError || "Could not load weapons."}
          </span>
          {error && !createError && (
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}

      <p aria-live="polite" className="text-[10px] font-bold uppercase tracking-widest text-[#666]">
        {loading ? "Loading weapons" : `${filtered.length} weapon${filtered.length === 1 ? "" : "s"}`}
      </p>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain border border-[#1a1a1a] bg-[#080808]">
        {loading &&
          Array.from({ length: 7 }, (_, index) => (
            <li key={index} className="flex items-center gap-3 border-t border-[#141414] p-3 first:border-t-0">
              <span className="h-12 w-20 shrink-0 animate-shimmer" />
              <span className="h-4 flex-1 animate-shimmer" />
            </li>
          ))}
        {filtered.map((gun) => {
          const busy = creating?.startsWith(`${gun.id}:`);
          return (
            <li
              key={gun.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#141414] px-3 py-2.5 first:border-t-0 sm:flex-nowrap sm:py-2"
              onPointerEnter={() => prefetch(gun, INTENT_DELAY_MS)}
              onPointerLeave={() => window.clearTimeout(intent.current)}
            >
              <span className="flex h-10 w-16 shrink-0 items-center justify-center bg-[#050505] sm:h-12 sm:w-20">
                {gun.gridImageLink && (
                  <Image src={gun.gridImageLink} alt="" width={80} height={48} className="h-full w-full object-contain p-0.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-semibold leading-snug text-[#ddd] sm:truncate">{gun.name}</span>
                <span className="block truncate text-xs text-[#888]">{gun.shortName}</span>
              </span>
              <span className="grid basis-full grid-cols-2 gap-2 sm:flex sm:basis-auto sm:gap-1.5">
                {gun.defaultPresetId && (
                  <Button
                    size="sm"
                    disabled={Boolean(creating)}
                    onFocus={() => prefetch(gun, 0)}
                    onClick={() => create(gun, true)}
                    className="h-10 sm:h-9 sm:min-w-24"
                    aria-label={`Create ${gun.shortName} from factory preset`}
                  >
                    {busy && creating?.endsWith("factory") ? <LoaderCircle className="animate-spin" /> : null}
                    Factory
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(creating)}
                  onClick={() => create(gun, false)}
                  className={cn("h-10 sm:h-9 sm:min-w-24", !gun.defaultPresetId && "col-span-2")}
                  aria-label={`Create empty ${gun.shortName} build`}
                >
                  {busy && creating?.endsWith("empty") ? <LoaderCircle className="animate-spin" /> : null}
                  Empty
                </Button>
              </span>
            </li>
          );
        })}
        {!loading && !error && filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-[#888]">No weapons match “{search.trim()}”.</li>
        )}
      </ul>
    </>
  );
}
