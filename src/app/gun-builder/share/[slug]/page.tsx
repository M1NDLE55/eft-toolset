"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createBuild, usePriceSources } from "@/app/lib/builds/store";
import { decodeBuildSharePayload, type DecodedSharedBuild } from "@/app/lib/builds/share";
import { collectItemIds, countParts } from "@/app/lib/builds/tree";
import { computeStats } from "@/app/lib/builds/stats";
import { layoutBuild } from "@/app/lib/builds/tree-layout";
import { useGunItems } from "@/app/lib/cache/gunBuilderHooks";
import { formatRub } from "@/app/components/gun-builder/format";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import { itemHref } from "@/app/lib/item-links";
import { useDocumentTitle } from "@/app/components/gun-builder/use-document-title";

type Decoded =
  | { payload: string; status: "ready"; build: DecodedSharedBuild }
  | { payload: string; status: "error"; message: string };

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function readPayload() {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("b") ?? "";
}

export default function SharedGunBuildPage() {
  const payload = useSyncExternalStore(subscribeHash, readPayload, () => null);
  const [decoded, setDecoded] = useState<Decoded | null>(null);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    decodeBuildSharePayload(payload)
      .then((build) => {
        if (!cancelled) setDecoded({ payload, status: "ready", build });
      })
      .catch(() => {
        if (!cancelled) {
          setDecoded({
            payload,
            status: "error",
            message: "This link is damaged or was created by an incompatible version. Ask for a fresh link.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (payload === "") {
    return <ShareError message="This shared build link is missing its build data. Make sure you copied the whole link." />;
  }
  const current = decoded?.payload === payload ? decoded : null;
  if (!current) return <ShareSkeleton />;
  if (current.status === "error") return <ShareError message={current.message} />;
  return <SharedBuildPreview build={current.build} />;
}

function ShareSkeleton() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ShareError({ message }: { message: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <AlertTriangle className="h-6 w-6 text-[#c8b384]" />
      <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Can&apos;t open build</h1>
      <p className="text-sm text-[#888]">{message}</p>
      <Button asChild variant="outline">
        <Link href="/gun-builder">Go to your builds</Link>
      </Button>
    </div>
  );
}

function SharedBuildPreview({ build }: { build: DecodedSharedBuild }) {
  const router = useRouter();
  const ids = useMemo(() => collectItemIds(build.root), [build.root]);
  const { items, loading, error, retry } = useGunItems(ids, "full");
  const priceSources = usePriceSources();
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const weapon = items.get(build.weaponId);
  const stats = computeStats(build.root, items, priceSources);
  const parts = countParts(build.root);
  const rows = layoutBuild(build.root, items).nodes.filter((node) => node.kind === "item");
  const name = build.name || weapon?.name.slice(0, MAX_BUILD_NAME_LENGTH) || "Shared build";
  useDocumentTitle(`${name} · Shared build`);

  function handleImport() {
    setImporting(true);
    setImportError("");
    try {
      const created = createBuild(name, build.weaponId, build.root);
      router.replace(`/gun-builder/${created.id}`);
    } catch (reason) {
      setImporting(false);
      setImportError(reason instanceof Error ? reason.message : "Could not save this build.");
    }
  }

  const summary = [
    { label: "Ergo", value: stats.ergonomics === null ? "—" : String(Math.round(stats.ergonomics)) },
    { label: "Recoil V", value: stats.recoilVertical === null ? "—" : String(Math.round(stats.recoilVertical)) },
    { label: "Recoil H", value: stats.recoilHorizontal === null ? "—" : String(Math.round(stats.recoilHorizontal)) },
    { label: "Weight", value: `${stats.weight.toFixed(2)} kg` },
    { label: "Cost", value: formatRub(stats.costRUB) },
  ];

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a8866]">Shared build</p>

      <div className="flex items-center gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-3">
        <span className="flex h-16 w-24 shrink-0 items-center justify-center bg-[#080808]">
          {weapon?.gridImageLink ? (
            <Image src={weapon.gridImageLink} alt="" width={96} height={64} className="h-full w-full object-contain p-0.5" />
          ) : loading ? (
            <span className="h-10 w-16 animate-shimmer" />
          ) : null}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black uppercase tracking-widest text-[#e6d9b8]">{name}</h1>
          <p className="truncate text-sm text-[#888]">
            {weapon?.name ?? (loading ? "Loading weapon…" : "Unknown weapon")} · {parts} part{parts === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-px border border-[#1a1a1a] bg-[#1a1a1a] sm:grid-cols-5">
        {summary.map((entry) => (
          <div key={entry.label} className="bg-[#0c0c0c] px-3 py-2">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-[#888]">{entry.label}</dt>
            <dd className="truncate text-sm font-black tabular-nums text-[#e6d9b8]">
              {loading ? <span className="mt-1 block h-4 w-12 animate-shimmer" /> : entry.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={handleImport} disabled={importing} className="sm:flex-1">
          {importing ? <LoaderCircle className="animate-spin" /> : <Download />}
          Save to my builds
        </Button>
        <Button asChild variant="outline">
          <Link href="/gun-builder">Cancel</Link>
        </Button>
      </div>
      {(importError || error) && (
        <div role="alert" className="flex items-center justify-between gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <span>{importError || "Part details could not be loaded. You can still save the build."}</span>
          {error && !importError && (
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}

      {parts > 0 && (
        <section aria-label="Parts" className="border border-[#1a1a1a] bg-[#0c0c0c]">
          <h2 className="border-b border-[#1a1a1a] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Parts
          </h2>
          <ul>
            {rows.map((node) => {
              const item = node.itemId ? items.get(node.itemId) : undefined;
              return (
                <li
                  key={node.id}
                  className="flex items-center gap-3 border-t border-[#141414] px-3 py-1.5 first:border-t-0"
                  style={{ paddingLeft: 12 + Math.min(node.path.length - 1, 6) * 12 }}
                >
                  <span className="flex h-8 w-10 shrink-0 items-center justify-center bg-[#080808]">
                    {item?.gridImageLink && (
                      <Image src={item.gridImageLink} alt="" width={40} height={32} className="h-full w-full object-contain p-0.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {item ? (
                      <Link
                        href={itemHref(item)}
                        prefetch={false}
                        className="block truncate text-sm text-[#ddd] hover:text-[#e6d9b8] hover:underline"
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm text-[#ddd]">{loading ? "Loading…" : "Unavailable item"}</span>
                    )}
                    {node.slot && <span className="block truncate text-[10px] uppercase tracking-widest text-[#666]">{node.slot.name}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
