"use client";

import { useState } from "react";
import { CloudOff, Map as MapIcon, Users } from "lucide-react";
import Link from "@/app/lib/navigation/link";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { prefetchMap } from "@/app/lib/raid-planner/prefetch";
import type { LibraryView } from "@/app/lib/account-sync/account-library";
import { useGameMode } from "@/components/game-mode/context";
import { eyebrow, focusRing } from "./ui";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * The account's plans (§4): the ones the user owns and the ones shared with them, as cached in this
 * browser (so the list works offline), plans made offline that haven't saved yet, and offline copies.
 * Each opens at /raid-planner/p/<id>; members, links, copying and deleting are in the plan's menu.
 */
export function AccountPlanRows({ view, onError }: { view: LibraryView; onError: (message: string) => void }) {
  const [filter, setFilter] = useState<"all" | "owned" | "shared">("all");
  void onError;
  const known = new Set(view.cachedPlans.map((plan) => plan.planId));
  const rows = [
    ...view.cachedPlans,
    // Index entries not cached yet (they download in the background).
    ...view.plans
      .filter((plan) => plan.status === "active" && !known.has(plan.id))
      .map((plan) => ({
        planId: plan.id,
        name: plan.name ?? "Untitled raid",
        mapKey: plan.mapKey ?? "",
        role: plan.role,
        relation: plan.relation,
        kind: "synced" as const,
        queued: 0,
        updatedAt: plan.updatedAt ?? plan.since,
        counts: null,
      })),
  ]
    .filter((plan) => filter === "all" || plan.relation === filter)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const shared = view.cachedPlans.some((plan) => plan.relation === "shared") || view.plans.some((plan) => plan.relation === "shared");

  return (
    <>
      {shared && (
        <div className="flex gap-2" role="group" aria-label="Show">
          {(["all", "owned", "shared"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setFilter(choice)}
              aria-pressed={filter === choice}
              className={cn(eyebrow, "border px-2 py-1", filter === choice ? "border-[#9a8866] text-[#e6d9b8]" : "border-[#2a2a2a] text-[#888]")}
            >
              {choice === "all" ? "All" : choice === "owned" ? "Mine" : "Shared with me"}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border border-dashed border-[#2a2a2a] p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-[#ccc]">No plans yet</p>
          <p className="text-sm text-[#888]">Plans are saved to your account, on every device you sign in on. Create one, import a plan file, or open a map below.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((plan) => (
            <AccountPlanRow key={plan.planId} plan={plan} />
          ))}
        </ul>
      )}
    </>
  );
}

function AccountPlanRow({ plan }: { plan: LibraryView["cachedPlans"][number] }) {
  const { gameMode } = useGameMode();
  const config = getMapConfig(plan.mapKey);
  const badge =
    plan.kind === "offline-copy" ? "Offline copy" : plan.kind === "pending-create" ? "Not saved yet" : plan.relation === "shared" ? (plan.role === "editor" ? "Editor" : "Viewer") : null;
  return (
    <li className="flex items-stretch border border-[#2a2a2a] bg-[#090909] transition-colors hover:border-[#3a3a3a]">
      <Link
        href={`/raid-planner/p/${plan.planId}`}
        onPointerEnter={() => config && prefetchMap(config, gameMode)}
        onFocus={() => config && prefetchMap(config, gameMode)}
        className={cn("group flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-3 sm:px-4", focusRing)}
      >
        <span className="flex items-center gap-2 truncate text-sm font-bold text-[#ddd] group-hover:text-[#c9b88d]">
          {plan.name || "Untitled raid"}
          {badge && <span className="border border-[#3a3326] px-1.5 text-3xs font-bold uppercase tracking-widest text-[#c8b384]">{badge}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-3xs uppercase tracking-widest text-[#888]">
          <span className="flex items-center gap-1 text-[#9a8866]">
            <MapIcon className="h-3 w-3" aria-hidden />
            {config?.name ?? "Unknown map"}
          </span>
          {plan.relation === "shared" && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden /> Shared with you
            </span>
          )}
          {plan.counts && (
            <span className="max-sm:hidden">
              {plan.counts.route} waypoints · {plan.counts.drawings} drawings · {plan.counts.notes} notes
            </span>
          )}
          {plan.queued > 0 && (
            <span className="flex items-center gap-1 text-[#c8b384]">
              <CloudOff className="h-3 w-3" aria-hidden /> {plan.queued} waiting
            </span>
          )}
          {plan.updatedAt > 0 && <span>{dateFormat.format(plan.updatedAt)}</span>}
        </span>
      </Link>
    </li>
  );
}
