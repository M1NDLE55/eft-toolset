"use client";

import { useEffect, useMemo, useState } from "react";
import { notFound, useParams, useRouter } from "next/navigation";
import { Copy, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import type { GunBuild, PriceSources } from "@/app/lib/types/gunBuilder";
import {
  deleteBuild,
  duplicateBuild,
  getBuild,
  renameBuild,
  saveBuild,
} from "@/app/lib/builds/store";
import { computeStats } from "@/app/lib/builds/stats";
import { ALL_PRICE_SOURCES } from "@/app/lib/builds/price";
import { collectItemIds } from "@/app/lib/builds/tree";
import { reconstructPresetTree } from "@/app/lib/builds/presets";
import { fetchPreset } from "@/app/lib/cache/gunBuilder";
import { useBuildItemData } from "@/app/lib/cache/gunBuilderHooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { BuildCanvas } from "@/app/components/gun-builder/build-canvas";
import { StatsPanel } from "@/app/components/gun-builder/stats-panel";
import { ShareBuild } from "@/app/components/gun-builder/share-build";

export default function GunBuildEditorPage() {
  const router = useRouter();
  const params = useParams<{ build: string }>();
  const [build, setBuild] = useState<GunBuild | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [presetLoading, setPresetLoading] = useState<string | null>(null);
  const [priceSources, setPriceSources] =
    useState<PriceSources>(ALL_PRICE_SOURCES);

  useEffect(() => {
    const found = getBuild(params.build);
    if (!found) notFound();
    setBuild(found);
    setRenameValue(found.name);
  }, [params.build]);

  const initialIds = useMemo(
    () => (build ? collectItemIds(build.root) : []),
    [build]
  );
  const { items, loading, gameMode, loadBuildItems } =
    useBuildItemData(initialIds);
  const weapon = build ? items.get(build.weaponId) : null;
  const stats = useMemo(
    () => (build ? computeStats(build.root, items, priceSources) : null),
    [build, items, priceSources]
  );

  if (!build || !stats) {
    return (
      <div className="flex w-full justify-center p-8">
        <LoaderCircle className="h-6 w-6 animate-spin text-[#9a8866]" />
      </div>
    );
  }

  const currentBuild = build;

  function handleRename() {
    if (!build) return;
    const name = renameValue.trim();
    if (!name) return;
    const updated = renameBuild(currentBuild.id, name);
    if (updated) {
      setBuild(updated);
      setRenameOpen(false);
    }
  }

  function handleDuplicate() {
    const duplicate = duplicateBuild(currentBuild.id);
    if (duplicate) router.push(`/gun-builder/${duplicate.id}`);
  }

  function handleDelete() {
    deleteBuild(currentBuild.id);
    router.push("/gun-builder");
  }

  async function handleLoadPreset(presetId: string) {
    setPresetLoading(presetId);
    try {
      const preset = await fetchPreset(presetId, gameMode);
      if (!preset) return;
      const fetched = await loadBuildItems([currentBuild.weaponId, ...preset.itemIds]);
      const map = new Map(items);
      for (const item of fetched) map.set(item.id, item);
      const updated = saveBuild({
        ...currentBuild,
        root: reconstructPresetTree(currentBuild.weaponId, preset, map),
      });
      setBuild(updated);
    } finally {
      setPresetLoading(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-3xl font-black uppercase tracking-widest text-[#9a8866]">
              {build.name}
            </h1>
            <Dialog
              open={renameOpen}
              onOpenChange={(open) => {
                setRenameOpen(open);
                if (open) setRenameValue(build.name);
              }}
            >
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">Rename build</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename build</DialogTitle>
                  <DialogDescription>Enter a new build name.</DialogDescription>
                </DialogHeader>
                <Input
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleRename();
                  }}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRenameOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleRename}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <p className="mt-1 text-xs uppercase tracking-widest text-[#666]">
            Prices &amp; stats for {gameMode === "pve" ? "PVE" : "PVP"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {weapon?.presets && weapon.presets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={Boolean(presetLoading)}>
                  {presetLoading ? "Loading" : "Load preset"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {weapon.presets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => handleLoadPreset(preset.id)}
                  >
                    {preset.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ShareBuild build={currentBuild} />
          <Button variant="outline" onClick={handleDuplicate}>
            <Copy className="h-4 w-4" />
            Duplicate
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4" />
                Delete
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
                <AlertDialogAction onClick={handleDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <StatsPanel
        stats={stats}
        priceSources={priceSources}
        onPriceSourcesChange={setPriceSources}
      />
      {loading && (
        <div className="flex items-center gap-2 text-sm text-[#777]">
          <LoaderCircle className="h-4 w-4 animate-spin text-[#9a8866]" />
          Loading build data
        </div>
      )}
      <BuildCanvas
        build={build}
        itemData={items}
        gameMode={gameMode}
        priceSources={priceSources}
        onBuildChange={setBuild}
        loadBuildItems={loadBuildItems}
      />
    </div>
  );
}
