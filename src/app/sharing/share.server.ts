import { countParts } from "@/app/lib/builds/tree";
import type { BuildValue, GroupValue } from "@/app/lib/sharing/types";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { shareForPage, type SharedSnapshot } from "@/app/lib/sharing/server/link-routes";

export type SharePreview =
  | { ok: true; share: SharedSnapshot; title: string; summary: string }
  | { ok: false; code: string; message: string };

/**
 * What a /s/ page shows and unfurls. Open Graph tags carry only the name and a summary: a plan's
 * map and counts, a build's weapon and parts, a group's item count. Never note text (§16.4).
 */
export async function sharePreview(request: Request, code: string): Promise<SharePreview> {
  const result = await shareForPage(request, code);
  if (!result.ok) return result;
  const { share } = result;
  if (share.targetType === "build") {
    const build = share.snapshot as BuildValue;
    const parts = countParts(build.root);
    return { ok: true, share, title: build.name, summary: `Weapon build with ${parts} part${parts === 1 ? "" : "s"}, shared by ${share.ownerDisplayName}.` };
  }
  if (share.targetType === "item_group") {
    const group = share.snapshot as GroupValue;
    return { ok: true, share, title: group.name, summary: `Item group of ${group.items.length} item${group.items.length === 1 ? "" : "s"}, shared by ${share.ownerDisplayName}.` };
  }
  const plan = share.snapshot as PlanContent;
  const map = getMapConfig(plan.mapKey)?.name ?? plan.mapKey;
  return {
    ok: true,
    share,
    title: plan.name,
    summary: `Raid plan on ${map}: ${plan.route.length} route points, ${plan.notes.length} notes. Shared by ${share.ownerDisplayName}.`,
  };
}
