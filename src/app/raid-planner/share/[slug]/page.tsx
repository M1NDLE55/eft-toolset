"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, MapPin, MoveUpRight, Route, StickyNote } from "lucide-react";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { importPlan } from "@/app/lib/raid-planner/store";
import { decodePlanSharePayload, type DecodedSharedPlan } from "@/app/lib/raid-planner/share";
import { Button } from "@/components/ui/button";
import { defaultFloor } from "@/app/components/raid-planner/floor-switcher";
import { LazyPlanEditorCanvas } from "@/app/components/raid-planner/lazy-canvas";

type Decoded = { payload: string; plan: DecodedSharedPlan } | { payload: string; error: string };

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export default function SharedPlanPage() {
  const router = useRouter();
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => null
  );
  const payload = hash === null ? null : (new URLSearchParams(hash.replace(/^#/, "")).get("p") ?? "");
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    decodePlanSharePayload(payload).then(
      (plan) => {
        if (cancelled) return;
        setDecoded(
          getMapConfig(plan.mapKey)
            ? { payload, plan }
            : { payload, error: "This shared plan uses a map that is no longer available." }
        );
      },
      () => {
        if (!cancelled) setDecoded({ payload, error: "This shared plan link is damaged or incomplete." });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const current = decoded?.payload === payload ? decoded : null;
  const shared = current && "plan" in current ? current.plan : null;
  const config = shared ? getMapConfig(shared.mapKey) : undefined;

  const previewPlan = useMemo<RaidPlan | null>(
    () =>
      shared && {
        id: "shared-preview",
        createdAt: 0,
        updatedAt: 0,
        ...shared,
      },
    [shared]
  );

  const error =
    payload === ""
      ? "This shared plan link is missing its plan data. Ask for the full link."
      : current && "error" in current
        ? current.error
        : null;

  function handleImport() {
    if (!shared) return;
    setImporting(true);
    setImportError("");
    try {
      const plan = importPlan(shared);
      router.replace(`/raid-planner/${plan.id}`);
    } catch (reason) {
      setImporting(false);
      setImportError(reason instanceof Error ? reason.message : "Could not import this plan.");
    }
  }

  if (error) {
    return (
      <div className="flex justify-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-lg flex-col gap-4 border border-[#2a2a2a] bg-[#090909] p-5">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[#c9b88d]">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Shared plan
          </p>
          <h1 className="text-2xl font-black uppercase tracking-widest">Link can&apos;t be opened</h1>
          <p className="text-sm text-[#aaa]">{error}</p>
          <Button asChild variant="outline" className="self-start">
            <Link href="/raid-planner">Go to raid planner</Link>
          </Button>
        </div>
      </div>
    );
  }

  const stats = shared
    ? [
        { icon: Route, label: "waypoint", value: shared.route.length },
        { icon: MoveUpRight, label: "drawing", value: shared.drawings.length },
        { icon: StickyNote, label: "note", value: shared.notes.length },
      ]
    : [];

  return (
    <div className="flex justify-center p-3 sm:p-6">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#9a8866]">Shared plan</p>
            {shared && config ? (
              <>
                <h1 className="line-clamp-2 break-words text-2xl font-black uppercase tracking-widest text-[#ddd] sm:text-3xl">
                  {shared.name}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-widest text-[#888]">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" aria-hidden />
                    {config.name}
                  </span>
                  {stats.map(({ icon: Icon, label, value }) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <Icon className="h-3 w-3" aria-hidden />
                      {value} {label}
                      {value === 1 ? "" : "s"}
                    </span>
                  ))}
                </p>
              </>
            ) : (
              <div className="mt-1 flex flex-col gap-2" aria-busy="true">
                <div className="h-8 w-64 max-w-full animate-pulse bg-[#151515]" />
                <div className="h-3 w-48 animate-pulse bg-[#151515]" />
              </div>
            )}
          </div>
          <div className="flex gap-2 max-sm:[&>*]:flex-1">
            <Button variant="outline" asChild>
              <Link href="/raid-planner">Cancel</Link>
            </Button>
            <Button onClick={handleImport} disabled={!shared || importing}>
              <Download aria-hidden />
              {importing ? "Saving…" : "Save a copy"}
            </Button>
          </div>
        </header>

        {importError && (
          <p role="alert" className="border border-red-900/60 bg-[#090909] px-3 py-2 text-sm text-red-200">
            {importError}
          </p>
        )}

        <div className="relative isolate h-[min(60dvh,40rem)] min-h-72 w-full overflow-hidden border border-[#2a2a2a] bg-[#050505]">
          {previewPlan && config && (
            <LazyPlanEditorCanvas
              config={config}
              activeFloor={defaultFloor(config)}
              details={null}
              enabledLayers={[]}
              plan={previewPlan}
            />
          )}
        </div>
        <p className="text-xs text-[#888]">
          Saving keeps a private copy in this browser. You can edit it freely without changing the original.
        </p>
      </div>
    </div>
  );
}
