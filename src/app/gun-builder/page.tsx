"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useGameMode } from "@/components/game-mode/context";
import type { BuildNode, GunBuild, GunListItem } from "@/app/lib/types/gunBuilder";
import {
  createBuild,
  deleteBuild,
  duplicateBuild,
  listBuilds,
  subscribeBuilds,
} from "@/app/lib/builds/store";
import { reconstructPresetTree } from "@/app/lib/builds/presets";
import { fetchBuildItems, fetchPreset } from "@/app/lib/cache/gunBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WeaponPicker } from "@/app/components/gun-builder/weapon-picker";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILDS } from "@/app/lib/builds/limits";

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export default function GunBuilderPage() {
  const router = useRouter();
  const { gameMode } = useGameMode();
  const [builds, setBuilds] = useState<GunBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [actionError, setActionError] = useState("");

  function refresh() {
    setBuilds(listBuilds());
  }

  useEffect(() => {
    refresh();
    setLoading(false);
    return subscribeBuilds(refresh);
  }, []);

  async function handleCreate(weapon: GunListItem, useDefaultPreset: boolean) {
    setCreating(true);
    setCreateError("");
    try {
      if (builds.length >= MAX_BUILDS) {
        throw new Error(`You can save at most ${MAX_BUILDS} builds.`);
      }
      let root: BuildNode | null = null;

      if (useDefaultPreset && weapon.defaultPresetId) {
        const [preset, items] = await Promise.all([
          fetchPreset(weapon.defaultPresetId, gameMode),
          fetchBuildItems([weapon.id], gameMode),
        ]);

        if (preset) {
          const presetItems = await fetchBuildItems(preset.itemIds, gameMode);
          const map = new Map(
            [...items, ...presetItems].map((item) => [item.id, item])
          );
          root = reconstructPresetTree(weapon.id, preset, map);
        }
      }

      const buildName = createName.trim() || weapon.name;
      if (buildName.length > MAX_BUILD_NAME_LENGTH) {
        throw new Error(`Build names can contain at most ${MAX_BUILD_NAME_LENGTH} characters.`);
      }
      const build = createBuild(buildName, weapon.id, root ?? undefined);

      setCreateOpen(false);
      setCreateName("");
      router.push(`/gun-builder/${build.id}`);
    } catch (reason) {
      setCreateError(
        reason instanceof Error ? reason.message : "Could not create this build."
      );
    } finally {
      setCreating(false);
    }
  }

  function handleDuplicate(id: string) {
    try {
      const duplicate = duplicateBuild(id);
      refresh();
      if (duplicate) router.push(`/gun-builder/${duplicate.id}`);
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not duplicate this build.");
    }
  }

  function handleDelete(id: string) {
    try {
      deleteBuild(id);
      refresh();
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete this build.");
    }
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      {actionError && <p role="alert" className="text-sm text-red-300">{actionError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black uppercase tracking-widest text-[#9a8866]">
          Gun Builder
        </h1>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (open) {
              setCreateName("");
              setCreateError("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create build</DialogTitle>
              <DialogDescription>
                Name the build, then choose a weapon.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={createName}
              maxLength={MAX_BUILD_NAME_LENGTH}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Build name, optional"
            />
            {createError && <p className="text-sm text-red-400">{createError}</p>}
            <WeaponPicker disabled={creating} onCreate={handleCreate} />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
        </div>
      ) : builds.length > 0 ? (
        <div className="flex flex-col gap-3">
          {builds.map((build) => (
            <div
              key={build.id}
              className="flex flex-wrap items-center gap-3 border border-[#2a2a2a] bg-[#090909] p-3"
            >
              <Button
                variant="secondary"
                className="min-w-0 flex-1 justify-between"
                asChild
              >
                <Link href={{ pathname: `/gun-builder/${build.id}` }}>
                  <span className="truncate">{build.name}</span>
                  <span className="text-[10px] uppercase tracking-widest text-[#888]">
                    {formatDate(build.updatedAt)}
                  </span>
                </Link>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleDuplicate(build.id)}
              >
                <Copy className="h-4 w-4" />
                <span className="sr-only">Duplicate build</span>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="icon">
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete build</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this build?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete{" "}
                      <span className="font-bold text-[#ccc]">{build.name}</span>.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(build.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      ) : (
        <p className="border border-[#2a2a2a] p-3 text-xl">No gun builds</p>
      )}
    </div>
  );
}
