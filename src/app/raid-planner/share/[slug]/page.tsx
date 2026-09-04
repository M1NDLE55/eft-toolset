"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { importPlan } from "@/app/lib/raid-planner/store";
import {
  decodePlanSharePayload,
  type DecodedSharedPlan,
} from "@/app/lib/raid-planner/share";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PlanEditorCanvas = dynamic(
  () =>
    import("@/app/components/raid-planner/plan-editor-canvas").then(
      (module) => module.PlanEditorCanvas
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  }
);

type ImportState =
  | { status: "reading" }
  | { status: "ready"; plan: DecodedSharedPlan }
  | { status: "error"; message: string };

export default function SharedPlanPage() {
  const router = useRouter();
  const [state, setState] = useState<ImportState>({ status: "reading" });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const payload = new URLSearchParams(hash).get("p");

    if (!payload) {
      setState({
        status: "error",
        message: "This shared plan link is missing its payload.",
      });
      return;
    }

    decodePlanSharePayload(payload)
      .then((plan) => {
        if (!getMapConfig(plan.mapKey)) {
          setState({
            status: "error",
            message: "This shared plan references an unknown map.",
          });
          return;
        }
        setState({ status: "ready", plan });
      })
      .catch(() =>
        setState({
          status: "error",
          message: "This shared plan link could not be read.",
        })
      );
  }, []);

  const previewPlan = useMemo<RaidPlan | null>(() => {
    if (state.status !== "ready") return null;
    return {
      id: "shared-preview",
      name: state.plan.name,
      mapKey: state.plan.mapKey,
      createdAt: 0,
      updatedAt: 0,
      enabledLayers: [],
      route: state.plan.route,
      drawings: state.plan.drawings,
      notes: state.plan.notes,
    };
  }, [state]);

  if (state.status === "reading") {
    return (
      <div className="flex w-full justify-center p-8">
        <LoaderCircle className="h-6 w-6 animate-spin text-[#9a8866]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex justify-center p-4">
        <div className="flex w-full max-w-xl flex-col gap-4 border border-[#2a2a2a] bg-[#090909] p-4">
          <div className="flex items-center gap-2 text-[#c9b88d]">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-xl font-black uppercase tracking-widest">
              Shared plan
            </h1>
          </div>
          <p className="text-sm text-[#aaa]">{state.message}</p>
          <Button
            variant="outline"
            onClick={() => router.replace("/raid-planner")}
          >
            Back to plans
          </Button>
        </div>
      </div>
    );
  }

  const config = getMapConfig(state.plan.mapKey)!;

  function handleImport() {
    if (state.status !== "ready") return;

    setImporting(true);
    setImportError("");
    try {
      const plan = importPlan({
        name: state.plan.name,
        mapKey: state.plan.mapKey,
        enabledLayers: state.plan.enabledLayers,
        route: state.plan.route,
        drawings: state.plan.drawings,
        notes: state.plan.notes,
      });
      router.replace(`/raid-planner/${plan.id}`);
    } catch (reason) {
      setImporting(false);
      setImportError(reason instanceof Error ? reason.message : "Could not import this plan.");
    }
  }

  return (
    <div className="flex justify-center p-4">
      <div className="flex w-full max-w-3xl flex-col gap-4 border border-[#2a2a2a] bg-[#090909] p-4">
        <h1 className="text-xl font-black uppercase tracking-widest text-[#9a8866]">
          Shared plan
        </h1>
        <div className="flex items-baseline gap-3 border border-[#222] bg-[#050505] p-3">
          <p className="truncate text-lg font-bold text-[#ddd]">
            {state.plan.name}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[#888]">
            {config.name}
          </p>
        </div>

        {previewPlan && (
          <div className="relative h-[50dvh] w-full overflow-hidden border border-[#222]">
            <PlanEditorCanvas
              config={config}
              activeFloor={
                config.floors.find((floor) => floor.show)?.id ?? null
              }
              details={null}
              enabledLayers={[]}
              plan={previewPlan}
              tool="select"
              color="#9a8866"
              interactive={false}
              onPlanChange={() => undefined}
              onSelectNote={() => undefined}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleImport} disabled={importing}>
            {importing ? "Importing" : "Save a copy"}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.replace("/raid-planner")}
          >
            Cancel
          </Button>
        </div>
        {importError && <p role="alert" className="text-sm text-red-300">{importError}</p>}
      </div>
    </div>
  );
}
