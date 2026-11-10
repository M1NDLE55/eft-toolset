import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { createId } from "@/app/lib/id";
import { isGunBuild } from "@/app/lib/builds/validation";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILDS } from "@/app/lib/builds/limits";
import { isGroup, type Group } from "@/app/lib/item-groups/validation";
import { MAX_GROUP_ITEMS, MAX_GROUP_NAME_LENGTH, MAX_GROUPS } from "@/app/lib/item-groups/limits";
import { describePlanProblem } from "@/app/lib/raid-planner/plan-validation";
import { MAX_PLAN_NAME_LENGTH, MAX_PLANS } from "@/app/lib/raid-planner/limits";
import { BACKUP_FORMAT, BACKUP_IMPORT_PARAM, BACKUP_VERSION, STORE_KEYS } from "@/app/lib/storage/store-keys";
import { resolveBuild } from "@/app/lib/builds/resolve";
import { decodePlanLink, planFromShared } from "@/app/lib/raid-planner/resolve";
import { matchItemReference, type ItemMatch, type MatchKind } from "@/app/lib/search/item-reference";
import { encodeSharePayload, MAX_SHARE_LINK_LENGTH } from "@/app/lib/share-codec";
import { betweenItems, InputError, type ToolContext } from "./context";
import { fuzzyBudget, isInexact, SKIPPED_NOTE } from "./item-match";
import { createImportLinkOutput } from "./output-schemas";
import { toolDefiner } from "./define-tool";
import { buildInputSchema, gameModeSchema } from "./schemas";
import { loadBuildSource, loadCatalogIndex } from "./sources";

/** Notes about individual item-group inputs, and build warnings, listed in one reply. */
const MAX_ITEM_NOTES = 20;
const MAX_BUILD_NOTES = 40;

export function registerImportLinkTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "create_import_link",
    {
      // Each call mints new ids and timestamps.
      annotations: { idempotentHint: false },
      outputSchema: createImportLinkOutput,
      inputSchema: {
        itemGroups: z
          .array(
            z.object({
              name: z.string().min(1).max(MAX_GROUP_NAME_LENGTH),
              items: z.array(z.string().min(1).max(500)).max(MAX_GROUP_ITEMS).describe("Item names, ids, or slugs."),
            })
          )
          .max(MAX_GROUPS)
          .default([]),
        builds: z.array(buildInputSchema).max(MAX_BUILDS).default([]),
        raidPlans: z
          .array(
            z.object({
              link: z.string().min(1).max(MAX_SHARE_LINK_LENGTH).describe("A raid plan share link from create_raid_plan."),
              name: z.string().max(MAX_PLAN_NAME_LENGTH).optional().describe("Rename the plan."),
            })
          )
          .max(MAX_PLANS)
          .default([]),
        gameMode: gameModeSchema,
      },
    },
    async ({ itemGroups, builds, raidPlans, gameMode }, { read }) => {
      if (itemGroups.length + builds.length + raidPlans.length === 0) {
        throw new InputError("Add at least one item group, build, or raid plan.");
      }
      const now = Date.now();
      const notes: string[] = [];
      const stores: Record<string, unknown> = {};
      const itemMatches: { group: string; input: string; item: string | null; matchedBy?: MatchKind }[] = [];

      if (itemGroups.length > 0) {
        const index = await loadCatalogIndex(read, gameMode);
        const budget = fuzzyBudget();
        const matches = new Map<string, ItemMatch>();
        // Notes about single items stop after a few; itemMatches still lists every input.
        let itemNotes = 0;
        let skipped = false;
        const noteItem = (note: string) => {
          itemNotes += 1;
          if (itemNotes <= MAX_ITEM_NOTES) notes.push(note);
        };
        const groups: Group[] = [];
        for (const group of itemGroups) {
          const names: string[] = [];
          for (const reference of group.items) {
            await betweenItems(context.signal);
            const match = matches.get(reference) ?? matchItemReference(index, reference, { budget });
            matches.set(reference, match);
            if (match.status !== "found") {
              if (match.status === "none" && match.skipped) skipped = true;
              noteItem(
                match.status === "ambiguous"
                  ? `${group.name}: "${reference}" could be any of ${match.candidates.join("; ")}, so it was left out. Add the one you mean by its full name.`
                  : `${group.name}: no item matches "${reference}", so it was left out.${match.suggestions.length ? ` Did you mean: ${match.suggestions.join("; ")}?` : ""}`
              );
              itemMatches.push({ group: group.name, input: reference, item: null });
              continue;
            }
            if (isInexact(match)) {
              const why = match.assumed ?? (match.matchedBy === "fuzzy" ? "Closest spelling." : "Best search match.");
              noteItem(`${group.name}: "${reference}" was matched to ${match.item.name}. ${why}`);
            }
            itemMatches.push({
              group: group.name,
              input: reference,
              item: match.item.name,
              ...(isInexact(match) ? { matchedBy: match.matchedBy } : {}),
            });
            if (!names.includes(match.item.name)) names.push(match.item.name);
          }
          const value = { name: group.name.trim(), items: names };
          if (!isGroup(value)) throw new InputError(`Item group "${group.name}" is invalid.`);
          groups.push(value);
        }
        if (itemNotes > MAX_ITEM_NOTES) {
          notes.push(`${itemNotes - MAX_ITEM_NOTES} more inputs were left out or matched inexactly; itemMatches lists them.`);
        }
        if (skipped) notes.push(`Some inputs were not checked for typos: ${SKIPPED_NOTE}.`);
        const seen = new Set<string>();
        for (const group of groups) {
          const key = group.name.toLocaleLowerCase();
          if (seen.has(key)) throw new InputError(`Two item groups are named "${group.name}".`);
          seen.add(key);
        }
        stores[STORE_KEYS.itemGroups] = groups;
      }

      if (builds.length > 0) {
        const data = await loadBuildSource(read, gameMode);
        const saved: GunBuild[] = [];
        let buildNotes = 0;
        for (const input of builds) {
          await betweenItems(context.signal);
          const build = await resolveBuild(data, input);
          for (const warning of build.warnings) {
            buildNotes += 1;
            if (buildNotes <= MAX_BUILD_NOTES) notes.push(`${build.name}: ${warning}`);
          }
          const value: GunBuild = {
            id: createId(),
            name: build.name.slice(0, MAX_BUILD_NAME_LENGTH),
            weaponId: build.weaponId,
            root: build.root,
            ...(build.ammoId ? { ammoId: build.ammoId } : {}),
            createdAt: now,
            updatedAt: now,
          };
          if (!isGunBuild(value)) throw new InputError(`Build "${build.name}" exceeds the builder's limits.`);
          saved.push(value);
        }
        if (buildNotes > MAX_BUILD_NOTES) notes.push(`And ${buildNotes - MAX_BUILD_NOTES} more build warnings.`);
        stores[STORE_KEYS.gunBuilds] = saved;
      }

      if (raidPlans.length > 0) {
        const plans: RaidPlan[] = [];
        for (const entry of raidPlans) {
          await betweenItems(context.signal);
          const plan = planFromShared(await decodePlanLink(entry.link), now);
          if (entry.name?.trim()) plan.name = entry.name.trim();
          const problem = describePlanProblem(plan);
          if (problem) throw new InputError(`Plan "${plan.name}" ${problem}.`);
          plans.push(plan);
        }
        stores[STORE_KEYS.raidPlans] = plans;
      }

      const file = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date(now).toISOString(),
        stores,
      };
      let payload: string;
      try {
        payload = await encodeSharePayload(file);
      } catch {
        throw new InputError("That is too much for one import link. Split it across several calls.");
      }
      return {
        importLink: `${context.origin}/data#${BACKUP_IMPORT_PARAM}=${payload}`,
        itemGroups: itemGroups.length,
        builds: builds.length,
        raidPlans: raidPlans.length,
        notes,
        ...(itemMatches.length ? { itemMatches } : {}),
      };
    }
  );
}
