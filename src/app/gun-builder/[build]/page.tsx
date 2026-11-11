"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Copy, GitCompareArrows, ListChecks, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import type { BuildNode, GunBuild } from "@/app/lib/types/gunBuilder";
import { useHydrated } from "@/app/lib/storage/use-store";
import {
  deleteBuild,
  duplicateBuild,
  findBuild,
  renameBuild,
  setBuildAmmo,
  setHideEmptySlots,
  setPriceSources,
  updateBuildTree,
  useBuilderView,
  useBuilds,
  usePriceSources,
} from "@/app/lib/builds/store";
import { computeStats, isDetailed, type MissingSlot } from "@/app/lib/builds/stats";
import { layoutBuild, type PositionedNode } from "@/app/lib/builds/tree-layout";
import {
  attachMod,
  carryOverChildren,
  collectItemIds,
  countParts,
  nodeAt,
  removeMod,
} from "@/app/lib/builds/tree";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import { optimizeBuild } from "@/app/lib/builds/optimizer";
import { treesEqual } from "@/app/lib/builds/compare";
import { ammoFits, ammoOptions } from "@/app/lib/builds/ammo";
import {
  detailedItems,
  ensureGunItems,
  getGunItemState,
  loadCompatibilityGraph,
  loadPresetTree,
  loadPurchaseContext,
  prefetchSlotItems,
} from "@/app/lib/cache/gunBuilder";
import { useAmmoItems, useGunItems, useGunList, usePurchaseContext } from "@/app/lib/cache/gunBuilderHooks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NameDialog } from "@/components/name-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LocalMissing } from "@/components/local-missing";
import { BuildCanvas } from "@/app/components/gun-builder/build-canvas";
import { StatsPanel, missingKey } from "@/app/components/gun-builder/stats-panel";
import { OptimizerDialog } from "@/app/components/gun-builder/optimizer-dialog";
import { UndoToast } from "@/app/components/gun-builder/undo-toast";
import { AmmoPanel, AmmoPicker } from "@/app/components/gun-builder/ammo-picker";
import { useDocumentTitle } from "@/app/components/gun-builder/use-document-title";
import { ShareBuild } from "@/app/components/gun-builder/share-build";
import { PresetDialog } from "@/app/components/gun-builder/preset-dialog";
import { SlotPicker, type PickerTarget } from "@/app/components/gun-builder/slot-picker";
import { modeLabel } from "@/app/components/gun-builder/format";
import { cn } from "@/lib/utils";

const UNDO_MS = 8_000;
const INTENT_DELAY_MS = 150;

function fullscreenContainer() {
  const element = document.fullscreenElement;
  return element instanceof HTMLElement ? element : null;
}

export default function GunBuildEditorPage() {
  const params = useParams<{ build: string }>();
  const hydrated = useHydrated();
  const build = findBuild(useBuilds(), params.build);

  if (!hydrated) return <EditorSkeleton />;
  if (!build) {
    return <LocalMissing title="Build not found" backHref="/gun-builder" backLabel="Back to builds" />;
  }
  return <BuildEditor key={build.id} build={build} />;
}

function EditorSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-20" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <Skeleton className="h-[118px] w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}

function BuildEditor({ build }: { build: GunBuild }) {
  const router = useRouter();
  const ids = useMemo(() => collectItemIds(build.root), [build.root]);
  const { items, loading, refreshing, unavailable, error, retry, gameMode } = useGunItems(ids, "full");
  const priceSources = usePriceSources();
  const { hideEmpty } = useBuilderView();
  const { byId } = useGunList();
  const [target, setTarget] = useState<PickerTarget | null>(null);
  const [actionError, setActionError] = useState("");
  const [undo, setUndo] = useState<{ root: BuildNode; label: string } | null>(null);
  const [filling, setFilling] = useState<string | null>(null);
  const [ammoOpen, setAmmoOpen] = useState(false);
  const selectedAmmoIds = useMemo(() => (build.ammoId ? [build.ammoId] : []), [build.ammoId]);
  const { items: ammoItems, loading: ammoLoading } = useAmmoItems(selectedAmmoIds);
  const intentTimer = useRef<number | undefined>(undefined);
  const undoTimer = useRef<number | undefined>(undefined);

  const gun = byId.get(build.weaponId);
  const weaponData = items.get(build.weaponId);
  const weapon = isDetailed(weaponData) ? weaponData : null;
  const ammoChoice = ammoOptions(build.root, items);
  const ammoData = build.ammoId ? ammoItems.get(build.ammoId) : undefined;
  const activeAmmo = ammoData && ammoFits(build.ammoId, ammoChoice) ? ammoData : null;
  const pricing = usePurchaseContext(build.weaponId, weapon?.defaultPresetId ?? gun?.defaultPresetId, items);
  const stats = computeStats(build.root, items, priceSources, activeAmmo, pricing);
  const flow = useMemo(() => layoutBuild(build.root, items, hideEmpty), [build.root, items, hideEmpty]);
  const parts = countParts(build.root);
  const image = weaponData?.gridImageLink ?? gun?.gridImageLink ?? null;
  const weaponName = weaponData?.name ?? gun?.name ?? null;
  useDocumentTitle(build.name || "Untitled build");

  function run(action: () => void) {
    try {
      action();
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save this change.");
    }
  }

  function offerUndo(label: string, previous: BuildNode = build.root) {
    window.clearTimeout(undoTimer.current);
    setUndo({ root: previous, label });
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  }

  function applyUndo() {
    if (!undo) return;
    const previous = undo.root;
    window.clearTimeout(undoTimer.current);
    setUndo(null);
    run(() => updateBuildTree(build.id, () => previous));
  }

  function openNode(node: PositionedNode) {
    if (!node.slot || node.slotId === null) return;
    setTarget({
      parentPath: node.parentPath,
      slotId: node.slotId,
      slot: node.slot,
      currentItemId: node.itemId,
      parentItemId: node.parentItemId,
      container: fullscreenContainer(),
    });
  }

  function openMissing(missing: MissingSlot) {
    setTarget({
      parentPath: missing.parentPath,
      slotId: missing.slot.id,
      slot: missing.slot,
      currentItemId: null,
      parentItemId: nodeAt(build.root, missing.parentPath)?.itemId ?? null,
      container: null,
    });
  }

  function prefetchNode(node: PositionedNode) {
    window.clearTimeout(intentTimer.current);
    const allowed = node.slot?.allowedItemIds;
    if (!allowed?.length) return;
    intentTimer.current = window.setTimeout(() => prefetchSlotItems(allowed, gameMode), INTENT_DELAY_MS);
  }

  function removeAt(path: string[], label: string) {
    run(() => {
      updateBuildTree(build.id, (root) => removeMod(root, path));
      offerUndo(label);
    });
  }

  async function selectPart(itemId: string) {
    const current = target;
    if (!current) return;
    if (itemId === current.currentItemId) {
      setTarget(null);
      return;
    }
    const path = [...current.parentPath, current.slotId];
    const existing = nodeAt(build.root, path);
    let child: BuildNode = { itemId, slots: {} };
    if (existing && Object.keys(existing.slots).length > 0) {
      await ensureGunItems([itemId, existing.itemId], gameMode, "full");
      const detailed = detailedItems(gameMode);
      const next = detailed.get(itemId);
      if (next) child = carryOverChildren(existing, detailed.get(existing.itemId), next);
    }
    updateBuildTree(build.id, (root) => attachMod(root, current.parentPath, current.slotId, child));
    if (existing) offerUndo(`Swapped ${items.get(existing.itemId)?.shortName ?? "part"}`);
    setActionError("");
    setTarget(null);
    void ensureGunItems([itemId], gameMode, "full").catch(() => undefined);
  }

  function replaceTree(base: BuildNode, next: BuildNode, label: string) {
    let applied = false;
    updateBuildTree(build.id, (root) => {
      if (!treesEqual(root, base)) return root;
      applied = true;
      return next;
    });
    if (!applied) throw new Error("The build changed in the meantime. Try again.");
    offerUndo(label, base);
  }

  async function fillCheapest(missing: MissingSlot | null) {
    const targets = missing ? [missing] : stats.missingRequired;
    if (filling || targets.length === 0) return;
    setFilling(missing ? missingKey(missing) : "all");
    setActionError("");
    const base = build.root;
    try {
      await ensureGunItems(collectItemIds(base), gameMode, "full");
      await loadCompatibilityGraph(
        targets.flatMap((entry) => entry.slot.allowedItemIds),
        gameMode,
        { requiredOnly: true }
      );
      const purchase = await loadPurchaseContext(build.weaponId, gameMode);
      const result = await optimizeBuild(base, getGunItemState(gameMode).items, {
        goal: "cost",
        priceSources,
        ...purchase,
        replaceExisting: false,
        target: missing ? { parentPath: missing.parentPath, slotId: missing.slot.id } : null,
        ammoId: build.ammoId ?? null,
      });
      if (!result.changed) {
        throw new Error(
          missing
            ? `No part with a price from your selected sources fits ${missing.slot.name}.`
            : "No parts with a price from your selected sources fit the empty required slots."
        );
      }
      const added = countParts(result.root) - countParts(base);
      replaceTree(
        base,
        result.root,
        missing
          ? `Filled ${missing.slot.name}${added > 1 ? ` (+${added} parts)` : ""}`
          : `Added ${added} cheapest part${added === 1 ? "" : "s"}`
      );
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not fill the slot.");
    } finally {
      setFilling(null);
    }
  }

  async function loadPreset(presetId: string, name: string) {
    const tree = await loadPresetTree(presetId, build.weaponId, gameMode);
    if (!tree) throw new Error("This preset is not available for this weapon.");
    updateBuildTree(build.id, () => tree);
    offerUndo(`Loaded ${name}`);
    setActionError("");
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/gun-builder"
          className="inline-flex h-6 w-fit items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All builds
        </Link>
        <Link
          href={`/gun-builder/compare?a=${encodeURIComponent(build.id)}`}
          className="inline-flex h-6 w-fit items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc]"
        >
          <GitCompareArrows className="h-3.5 w-3.5" /> Compare
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="hidden h-14 w-24 shrink-0 items-center justify-center border border-[#1a1a1a] bg-[#0c0c0c] sm:flex">
            {image ? (
              <Image src={image} alt="" width={96} height={56} className="h-full w-full object-contain p-0.5" priority />
            ) : (
              <span className="h-9 w-16 animate-shimmer" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="truncate text-xl font-black uppercase tracking-widest text-[#e6d9b8] sm:text-2xl">
                {build.name || "Untitled build"}
              </h1>
              <NameDialog
                trigger={
                  <Button variant="ghost" size="icon" className="shrink-0" aria-label="Rename build">
                    <Pencil />
                  </Button>
                }
                title="Rename build"
                description="Enter a new name for this build."
                initialName={build.name}
                submitLabel="Save"
                maxLength={MAX_BUILD_NAME_LENGTH}
                onSubmit={(name) => renameBuild(build.id, name)}
              />
            </div>
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#888]">
              <span className="min-w-0 truncate">{weaponName ?? "Loading weapon…"}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">
                {parts} part{parts === 1 ? "" : "s"}
              </span>
              <span aria-hidden>·</span>
              <span className="flex shrink-0 items-center gap-1 uppercase tracking-widest">
                {modeLabel(gameMode)} prices
                {refreshing && !loading && (
                  <LoaderCircle className="h-3 w-3 animate-spin text-[#9a8866]" aria-label="Updating prices" />
                )}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 max-sm:[&>*]:flex-1 max-lg:[&>*]:px-0 sm:max-lg:[&>*]:w-10">
          <PresetDialog
            weapon={weapon}
            hasParts={parts > 0}
            onLoad={loadPreset}
            onClear={() =>
              run(() => {
                updateBuildTree(build.id, (root) => ({ itemId: root.itemId, slots: {} }));
                offerUndo("Stripped all parts");
              })
            }
          />
          <OptimizerDialog
            build={build}
            gameMode={gameMode}
            priceSources={priceSources}
            currentCost={stats.costRUB}
            ammo={ammoData ?? null}
            disabled={!weapon}
            onApply={(root, base, label) => run(() => replaceTree(base, root, label))}
          />
          <ShareBuild build={build} />
          <Button asChild variant="outline">
            <Link href={`/gun-builder/${build.id}/list`} aria-label="Shopping list">
              <ListChecks />
              <span className="max-lg:sr-only">List</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            aria-label="Duplicate build"
            onClick={() =>
              run(() => {
                const copy = duplicateBuild(build.id);
                router.push(`/gun-builder/${copy.id}`);
              })
            }
          >
            <Copy />
            <span className="max-lg:sr-only">Duplicate</span>
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="outline" className="text-red-300 hover:text-red-200" aria-label="Delete build">
                <Trash2 />
                <span className="max-lg:sr-only">Delete</span>
              </Button>
            }
            title={`Delete “${build.name}”?`}
            description="This permanently removes the build from this browser."
            confirmLabel="Delete build"
            onConfirm={() =>
              run(() => {
                deleteBuild(build.id);
                router.push("/gun-builder");
              })
            }
          />
        </div>
      </div>

      {(actionError || error) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {actionError || "Some part data could not be loaded."}
          </span>
          {error && !actionError && (
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}

      <StatsPanel
        stats={stats}
        loading={loading}
        priceSources={priceSources}
        onPriceSourcesChange={(sources) => run(() => setPriceSources(sources))}
        onFillSlot={openMissing}
        onFillCheapest={(missing) => void fillCheapest(missing)}
        filling={filling}
      />

      <AmmoPanel
        ammo={ammoData}
        ammoId={build.ammoId ?? null}
        options={ammoChoice}
        loading={ammoLoading}
        priceSources={priceSources}
        onOpen={() => setAmmoOpen(true)}
        onClear={() => run(() => setBuildAmmo(build.id, null))}
      />
      <AmmoPicker
        open={ammoOpen}
        options={ammoChoice}
        selectedId={build.ammoId ?? null}
        priceSources={priceSources}
        onClose={() => setAmmoOpen(false)}
        onSelect={(ammoId) => {
          setAmmoOpen(false);
          run(() => setBuildAmmo(build.id, ammoId));
        }}
      />

      <div className="-mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#888]">Parts</h2>
        <button
          type="button"
          aria-pressed={hideEmpty}
          onClick={() => run(() => setHideEmptySlots(!hideEmpty))}
          className="flex h-9 items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ccc] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
        >
          <span
            aria-hidden
            className={cn(
              "flex h-4 w-7 items-center border p-0.5 transition-colors",
              hideEmpty ? "justify-end border-[#9a8866] bg-[#9a8866]/20" : "justify-start border-[#3a3a3a]"
            )}
          >
            <span className={cn("h-2.5 w-2.5", hideEmpty ? "bg-[#e6d9b8]" : "bg-[#555]")} />
          </span>
          Hide optional empty slots
        </button>
      </div>

      <BuildCanvas
        flow={flow}
        items={items}
        loading={loading}
        unavailable={unavailable}
        weaponFallback={gun}
        onOpen={openNode}
        onRemove={(node) =>
          removeAt(node.path, `Removed ${(node.itemId && items.get(node.itemId)?.shortName) || "part"}`)
        }
        onIntent={prefetchNode}
      />

      <SlotPicker
        target={target}
        root={build.root}
        lookup={items}
        priceSources={priceSources}
        onClose={() => setTarget(null)}
        onSelect={selectPart}
        onRemove={() => {
          const current = target;
          if (!current) return;
          setTarget(null);
          removeAt(
            [...current.parentPath, current.slotId],
            `Removed ${(current.currentItemId && items.get(current.currentItemId)?.shortName) || "part"}`
          );
        }}
      />

      <UndoToast label={undo?.label ?? null} onUndo={applyUndo} />
    </div>
  );
}
