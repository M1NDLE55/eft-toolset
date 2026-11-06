"use client";

import { useParams } from "next/navigation";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { usePlans } from "@/app/lib/raid-planner/store";
import { useHydrated } from "@/app/lib/storage/use-store";
import { LocalMissing } from "@/components/local-missing";
import { MapStageSkeleton } from "@/app/components/raid-planner/map-chrome";
import { PlanEditor } from "@/app/components/raid-planner/plan-editor";

export default function PlanEditorPage() {
  const { plan: id } = useParams<{ plan: string }>();
  const hydrated = useHydrated();
  const plan = usePlans().find((candidate) => candidate.id === id);

  if (!hydrated) return <MapStageSkeleton>Loading plan</MapStageSkeleton>;
  if (!plan) {
    return <LocalMissing title="Plan not found" backHref="/raid-planner" backLabel="Back to plans" />;
  }
  const config = getMapConfig(plan.mapKey);
  if (!config) {
    return (
      <LocalMissing title="Plan map is no longer available" backHref="/raid-planner" backLabel="Back to plans" />
    );
  }
  return <PlanEditor key={plan.id} storedPlan={plan} config={config} />;
}
