"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Map as MapIcon, Plus, Trash2 } from "lucide-react";
import type { MapConfig, RaidPlan } from "@/app/lib/raid-planner/types";
import { getMapConfig, mapConfigs } from "@/app/lib/raid-planner/maps-config";
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  listPlans,
  subscribePlans,
} from "@/app/lib/raid-planner/store";
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
import { MapPicker } from "@/app/components/raid-planner/map-picker";
import { MAX_PLAN_NAME_LENGTH, MAX_PLANS } from "@/app/lib/raid-planner/limits";

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export default function RaidPlannerPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<RaidPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [actionError, setActionError] = useState("");

  function refresh() {
    setPlans(listPlans());
  }

  useEffect(() => {
    refresh();
    setLoading(false);
    return subscribePlans(refresh);
  }, []);

  function handleCreate(config: MapConfig) {
    try {
      if (plans.length >= MAX_PLANS) throw new Error(`You can save at most ${MAX_PLANS} plans.`);
      const name = createName.trim() || `${config.name} raid`;
      if (name.length > MAX_PLAN_NAME_LENGTH) throw new Error(`Plan names can contain at most ${MAX_PLAN_NAME_LENGTH} characters.`);
      const plan = createPlan(name, config.key);
      setCreateOpen(false);
      setCreateName("");
      setActionError("");
      router.push(`/raid-planner/${plan.id}`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not create this plan.");
    }
  }

  function handleDuplicate(id: string) {
    try {
      const duplicate = duplicatePlan(id);
      refresh();
      if (duplicate) router.push(`/raid-planner/${duplicate.id}`);
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not duplicate this plan.");
    }
  }

  function handleDelete(id: string) {
    try {
      deletePlan(id);
      refresh();
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete this plan.");
    }
  }

  return (
    <div className="flex justify-center p-4 sm:min-h-[calc(100vh-130px)] min-h-[calc(100vh-65px)]">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        {actionError && <p role="alert" className="text-sm text-red-300">{actionError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-black uppercase tracking-widest text-[#9a8866]">
            Raid Planner
          </h1>
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              if (open) setCreateName("");
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create plan</DialogTitle>
                <DialogDescription>
                  Name the plan, then choose a map.
                </DialogDescription>
              </DialogHeader>
              <Input
                value={createName}
                maxLength={MAX_PLAN_NAME_LENGTH}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Plan name, optional"
              />
              <MapPicker onPick={handleCreate} />
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[72px] w-full" />
            <Skeleton className="h-[72px] w-full" />
            <Skeleton className="h-[72px] w-full" />
          </div>
        ) : plans.length > 0 ? (
          <div className="flex flex-col gap-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-wrap items-center gap-3 border border-[#2a2a2a] bg-[#090909] p-3"
              >
                <Button
                  variant="secondary"
                  className="min-w-0 flex-1 justify-between"
                  asChild
                >
                  <Link href={{ pathname: `/raid-planner/${plan.id}` }}>
                    <span className="truncate">{plan.name}</span>
                    <span className="text-[10px] uppercase tracking-widest text-[#888]">
                      {getMapConfig(plan.mapKey)?.name ?? plan.mapKey} ·{" "}
                      {formatDate(plan.updatedAt)}
                    </span>
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleDuplicate(plan.id)}
                >
                  <Copy className="h-4 w-4" />
                  <span className="sr-only">Duplicate plan</span>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="icon">
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete plan</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this plan?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently
                        delete{" "}
                        <span className="font-bold text-[#ccc]">{plan.name}</span>.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(plan.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        ) : (
          <p className="border border-[#2a2a2a] p-3 text-xl">No raid plans</p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
            Or browse a map without a plan
          </h2>
          <div className="flex flex-wrap gap-2">
            {mapConfigs.map((config) => (
              <Link
                key={config.key}
                href={{ pathname: `/raid-planner/map/${config.key}` }}
                className="flex items-center gap-1.5 border border-[#2a2a2a] bg-[#090909] px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#888] transition-colors hover:border-[#9a8866] hover:text-[#ccc]"
              >
                <MapIcon className="h-3 w-3" />
                {config.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
