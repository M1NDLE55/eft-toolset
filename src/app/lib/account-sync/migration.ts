import type { GunBuild } from "@/app/lib/types/gunBuilder";
import type { Group } from "@/app/lib/item-groups/validation";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { buildHash, groupHash, planHash } from "@/app/lib/sharing/content-hash";
import { PLAN_LIMITS } from "@/app/lib/durable/limits";

/**
 * Moving the signed-out browser library to an account (§14.5). Items already in the account (same
 * content hash) are left out; when a type has more than fits, the most recently updated are
 * preselected; plans over the account's content caps are flagged and stay in the browser.
 */
export type MigrationType = "build" | "item_group" | "plan";

export interface MigrationCandidate {
  type: MigrationType;
  /** Identity in the browser store: build or plan id, or the group's name. */
  key: string;
  name: string;
  updatedAt: number;
  hash: string;
  value: unknown;
  /** Why it can't move as it is (plans over the account caps). */
  blocked?: string;
}

export function planCapProblem(plan: RaidPlan): string | null {
  if (plan.route.length > PLAN_LIMITS.maxRoutePoints) return `more than ${PLAN_LIMITS.maxRoutePoints} route points`;
  if (plan.drawings.length > PLAN_LIMITS.maxDrawings) return `more than ${PLAN_LIMITS.maxDrawings} drawings`;
  if (plan.drawings.some((drawing) => drawing.points.length > PLAN_LIMITS.maxPointsPerDrawing)) return "a drawing with too much detail";
  if (plan.drawings.reduce((total, drawing) => total + drawing.points.length, 0) > PLAN_LIMITS.maxDrawingPoints) return "too much drawing detail";
  if (plan.notes.length > PLAN_LIMITS.maxNotes) return `more than ${PLAN_LIMITS.maxNotes} notes`;
  if (plan.notes.some((note) => note.body.length > PLAN_LIMITS.maxNoteBodyLength)) return `a note longer than ${PLAN_LIMITS.maxNoteBodyLength} characters`;
  return null;
}

export function migrationCandidates(
  library: { builds: GunBuild[]; groups: Group[]; plans: RaidPlan[] },
  accountHashes: { builds: string[]; itemGroups: string[]; plans: string[] }
): MigrationCandidate[] {
  const known = new Set([...accountHashes.builds, ...accountHashes.itemGroups, ...accountHashes.plans]);
  const candidates: MigrationCandidate[] = [
    ...library.builds.map((build) => ({
      type: "build" as const,
      key: build.id,
      name: build.name,
      updatedAt: build.updatedAt,
      hash: buildHash(build),
      value: { name: build.name, weaponId: build.weaponId, root: build.root, ...(build.ammoId ? { ammoId: build.ammoId } : {}) },
    })),
    ...library.groups.map((group, index) => ({
      type: "item_group" as const,
      key: group.name,
      name: group.name,
      updatedAt: library.groups.length - index,
      hash: groupHash(group),
      value: { name: group.name, items: group.items },
    })),
    ...library.plans.map((plan) => {
      const problem = planCapProblem(plan);
      return {
        type: "plan" as const,
        key: plan.id,
        name: plan.name,
        updatedAt: plan.updatedAt,
        hash: planHash(plan),
        value: { name: plan.name, mapKey: plan.mapKey, enabledLayers: plan.enabledLayers, route: plan.route, drawings: plan.drawings, notes: plan.notes },
        ...(problem ? { blocked: `This plan has ${problem}, more than an account plan can hold.` } : {}),
      };
    }),
  ];
  return candidates.filter((candidate) => !known.has(candidate.hash));
}

/** The most recently updated movable items of each type, up to the room left. */
export function preselect(candidates: MigrationCandidate[], room: Record<MigrationType, number>): Set<string> {
  const selected = new Set<string>();
  for (const type of ["build", "item_group", "plan"] as const) {
    candidates
      .filter((candidate) => candidate.type === type && !candidate.blocked)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, room[type]))
      .forEach((candidate) => selected.add(selectionKey(candidate)));
  }
  return selected;
}

export function selectionKey(candidate: Pick<MigrationCandidate, "type" | "key">) {
  return `${candidate.type}:${candidate.key}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
