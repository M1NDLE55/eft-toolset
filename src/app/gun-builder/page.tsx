"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Copy, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useHydrated } from "@/app/lib/storage/use-store";
import { deleteBuild, duplicateBuild, sortBuilds, useBuilds } from "@/app/lib/builds/store";
import { collectItemIds, countParts } from "@/app/lib/builds/tree";
import { prefetchBuildItems } from "@/app/lib/cache/gunBuilder";
import { useGameMode } from "@/components/game-mode/context";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import { useGunList } from "@/app/lib/cache/gunBuilderHooks";
import { NewBuildDialog } from "@/app/components/gun-builder/weapon-picker";
import { formatDate } from "@/app/components/gun-builder/format";

const FILTER_THRESHOLD = 6;

export default function GunBuilderPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const builds = sortBuilds(useBuilds());
  const { byId, loading: gunsLoading } = useGunList();
  const [filter, setFilter] = useState("");
  const [actionError, setActionError] = useState("");
  const { gameMode } = useGameMode();
  const intent = useRef<number | undefined>(undefined);

  function prefetch(build: GunBuild, delay: number) {
    window.clearTimeout(intent.current);
    intent.current = window.setTimeout(() => prefetchBuildItems(collectItemIds(build.root), gameMode), delay);
  }

  const phrase = filter.trim().toLowerCase();
  const visible = phrase
    ? builds.filter((build) => {
        const gun = byId.get(build.weaponId);
        return (
          build.name.toLowerCase().includes(phrase) ||
          gun?.name.toLowerCase().includes(phrase) ||
          gun?.shortName.toLowerCase().includes(phrase)
        );
      })
    : builds;

  function run(action: () => void) {
    try {
      action();
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save this change.");
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Gun builder</h1>
          <p className="mt-1 text-sm text-[#888]">Assemble weapons, compare stats and cost. Saved in this browser.</p>
        </div>
        <NewBuildDialog
          trigger={
            <Button>
              <Plus /> New build
            </Button>
          }
        />
      </div>

      {actionError && (
        <p role="alert" className="border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {actionError}
        </p>
      )}

      {!hydrated ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[74px] w-full" />
          ))}
        </div>
      ) : builds.length === 0 ? (
        <div className="flex flex-col items-center gap-3 border border-dashed border-[#2a2a2a] px-6 py-12 text-center">
          <p className="font-semibold text-[#ccc]">No builds yet</p>
          <p className="max-w-sm text-sm text-[#888]">
            Start from a weapon&apos;s factory preset or a bare receiver, then swap parts to see ergonomics, recoil and cost update live.
          </p>
          <NewBuildDialog
            trigger={
              <Button variant="outline" className="mt-1">
                <Plus /> Create your first build
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {builds.length >= FILTER_THRESHOLD && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" />
              <Input
                className="pl-9"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={`Filter ${builds.length} builds`}
                aria-label="Filter builds"
              />
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {visible.map((build) => {
              const gun = byId.get(build.weaponId);
              const parts = countParts(build.root);
              return (
                <li key={build.id} className="group flex items-stretch border border-[#1a1a1a] bg-[#0c0c0c] transition-colors hover:border-[#9a8866] focus-within:border-[#9a8866]">
                  <Link
                    href={`/gun-builder/${build.id}`}
                    onPointerEnter={() => prefetch(build, 80)}
                    onPointerLeave={() => window.clearTimeout(intent.current)}
                    onPointerDown={() => prefetch(build, 0)}
                    onFocus={() => prefetch(build, 0)}
                    className="flex min-w-0 flex-1 items-center gap-3 p-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8]"
                  >
                    <span className="flex h-10 w-14 shrink-0 items-center justify-center bg-[#080808] sm:h-12 sm:w-20">
                      {gun?.gridImageLink ? (
                        <Image src={gun.gridImageLink} alt="" width={80} height={48} className="h-full w-full object-contain p-0.5" />
                      ) : gunsLoading ? (
                        <span className="h-8 w-14 animate-shimmer" />
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 font-semibold leading-snug break-words text-[#ddd] group-hover:text-[#e6d9b8] sm:truncate">
                        {build.name || "Untitled build"}
                      </span>
                      <span className="truncate text-xs text-[#888]">
                        {gun?.shortName ?? "Weapon"} · {parts} part{parts === 1 ? "" : "s"} · {formatDate(build.updatedAt)}
                      </span>
                    </span>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-[#9a8866] sm:block" />
                  </Link>
                  <div className="flex shrink-0 items-center border-l border-[#1a1a1a]">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-full min-h-10 w-11"
                      aria-label={`Duplicate ${build.name}`}
                      onClick={() =>
                        run(() => {
                          const copy = duplicateBuild(build.id);
                          router.push(`/gun-builder/${copy.id}`);
                        })
                      }
                    >
                      <Copy />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-full min-h-10 w-11 hover:text-red-300"
                          aria-label={`Delete ${build.name}`}
                        >
                          <Trash2 />
                        </Button>
                      }
                      title={`Delete “${build.name}”?`}
                      description="This permanently removes the build from this browser."
                      confirmLabel="Delete build"
                      onConfirm={() => run(() => deleteBuild(build.id))}
                    />
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">
                No builds match “{filter.trim()}”.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
