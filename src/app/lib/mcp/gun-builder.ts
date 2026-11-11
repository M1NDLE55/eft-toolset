import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPreset } from "@/app/lib/api/tarkov-server";
import type { BuildNode } from "@/app/lib/types/gunBuilder";
import { filterCatalog } from "@/app/lib/search/filter-catalog";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { ammoOptions } from "@/app/lib/builds/ammo";
import { diffBuildTrees, statDeltas } from "@/app/lib/builds/compare";
import { conflictReason, installedOutside } from "@/app/lib/builds/conflicts";
import { optimizeBuild, type OptimizeGoal, type OptimizeOptions } from "@/app/lib/builds/optimizer";
import { reconstructPresetTree } from "@/app/lib/builds/presets";
import { presetParts } from "@/app/lib/builds/purchase";
import { effectivePrice, offerLabel, traderLabel } from "@/app/lib/builds/price";
import {
  asCatalog,
  collectPaths,
  installPart,
  itemName,
  resolveAmmo,
  resolveBuild,
  resolveSlotPath,
  resolveWeapon,
  slotLabel,
  type BuildSource,
} from "@/app/lib/builds/resolve";
import { buildShoppingList, formatShoppingList } from "@/app/lib/builds/shopping";
import { computeStats } from "@/app/lib/builds/stats";
import { removeMod } from "@/app/lib/builds/tree";
import {
  caliberId,
  describeBuild,
  formatCaliber,
  itemRow,
  priceNote,
  projectAmmo,
  projectStats,
} from "./build-projection";
import { loadBuildPricing, purchaseContext } from "./build-prices";
import { InputError, round, type ToolContext } from "./context";
import {
  compareBuildsOutput,
  evaluateBuildOutput,
  getAmmoOptionsOutput,
  getSlotOptionsOutput,
  getWeaponOutput,
  listWeaponsOutput,
  modifyBuildOutput,
  optimizeBuildOutput,
} from "./output-schemas";
import { toolDefiner } from "./define-tool";
import { buildInputSchema, gameModeSchema, offsetSchema, page, priceSourcesSchema, slotPathSchema } from "./schemas";
import { itemUrl, loadBuildSource } from "./sources";

const OPTIMIZE_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_OPTIMIZERS = 2;
let runningOptimizers = 0;

/** One optimiser time limit per tool call, shared by every optimiser run in that call. */
function optimizerDeadline(context: ToolContext) {
  return AbortSignal.any([context.signal, AbortSignal.timeout(OPTIMIZE_TIMEOUT_MS)]);
}

/** Runs the optimiser; running out of its time limit surfaces as an error the model can act on. */
async function runOptimizer(
  root: BuildNode,
  lookup: BuildSource["lookup"],
  options: OptimizeOptions,
  deadline: AbortSignal,
  context: ToolContext
) {
  // The optimiser is CPU-bound, so only a few runs share an instance with the website.
  if (runningOptimizers >= MAX_CONCURRENT_OPTIMIZERS) {
    throw new InputError("The optimiser is busy with other builds. Try again in a few seconds.");
  }
  runningOptimizers += 1;
  try {
    return await optimizeBuild(root, lookup, options, { signal: deadline });
  } catch (error) {
    if (deadline.aborted && !context.signal.aborted) {
      throw new InputError(
        "The optimiser ran out of time. Narrow it with slotPath, keepInstalledParts, or a single price source."
      );
    }
    throw error;
  } finally {
    runningOptimizers -= 1;
  }
}

const itemReference = z.string().min(1).max(200);

function formatRoubles(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} RUB`;
}

const buyableOnlySchema = z
  .boolean()
  .default(false)
  .describe("Only list what can be bought from the price sources at the allowed trader levels.");

const buildChangeSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("install"), slotPath: slotPathSchema, item: itemReference.describe("Part id or name.") })
    .describe("Install a part, replacing what is there and keeping attachments that still fit."),
  z.object({ action: z.literal("remove"), slotPath: slotPathSchema }).describe("Empty a slot."),
  z
    .object({
      action: z.literal("fill_required"),
      slotPath: slotPathSchema.optional().describe("Only fill this slot and what attaches to it."),
    })
    .describe("Fill empty required slots and an empty magazine slot with the cheapest compatible parts."),
  z
    .object({
      action: z.literal("set_ammo"),
      item: itemReference.optional().describe("Ammo id or name."),
      ammo: itemReference.optional().describe("Same as item."),
    })
    .refine((change) => Boolean(change.item ?? change.ammo), { message: "set_ammo needs item (an ammo id or name)." })
    .describe("Load ammo."),
  z.object({ action: z.literal("clear_ammo") }).describe("Unload the ammo."),
]);

/**
 * What modify_build publishes for a change: one object whose action says what the other
 * fields mean, instead of a five-way union that repeats slotPath. It passes the change on
 * unchanged, so the union above still validates it and words its errors.
 */
const buildChangeInput = z
  .looseObject({
    action: z
      .enum(["install", "remove", "fill_required", "set_ammo", "clear_ammo"])
      .describe(
        "install: put item in slotPath, replacing what is there and keeping attachments that fit. remove: empty slotPath. fill_required: fill empty required slots and an empty magazine slot (only under slotPath, if given) with the cheapest parts. set_ammo: load item. clear_ammo: unload."
      ),
    slotPath: slotPathSchema.optional(),
    item: itemReference.optional().describe("Part or ammo id or name."),
  })
  .pipe(buildChangeSchema);

export function registerGunBuilderTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "list_weapons",
    {
      outputSchema: listWeaponsOutput,
      inputSchema: {
        query: z.string().max(200).optional().describe("Name search, for example \"M4A1\" or \"AK\"."),
        caliber: z.string().max(40).optional().describe('Caliber filter, for example "5.56x45" or "7.62x39".'),
        gameMode: gameModeSchema,
        limit: z.number().int().min(1).max(300).default(25),
        offset: offsetSchema,
      },
    },
    async ({ query, caliber, gameMode, limit, offset }, { read }) => {
      const data = await loadBuildSource(read, gameMode);
      const compact = (value: string) => normalizeText(value).replace(/[^a-z0-9]/g, "");
      const caliberNeedle = caliber ? compact(caliber) : "";
      let rows = data.guns.flatMap((gun) => {
        const raw = data.lookup.get(gun.id)?.caliber;
        const weaponCaliber = formatCaliber(raw);
        const id = caliberId(raw);
        if (caliberNeedle && ![weaponCaliber, id].some((value) => value && compact(value).includes(caliberNeedle))) {
          return [];
        }
        return [
          {
            id: gun.id,
            name: gun.name,
            shortName: gun.shortName,
            caliber: weaponCaliber,
            caliberId: id,
            hasDefaultPreset: Boolean(gun.defaultPresetId),
          },
        ];
      });
      if (query?.trim()) {
        const byId = new Map(rows.map((row) => [row.id, row]));
        rows = filterCatalog(asCatalog(rows), query, [], rows.length, rows.length).map((match) => byId.get(match.id)!);
      } else {
        rows = rows.toSorted((a, b) => a.name.localeCompare(b.name));
      }
      const { items, nextOffset } = page(rows, offset, limit);
      return { gameMode, total: rows.length, weapons: items, nextOffset };
    }
  );

  define(
    "get_weapon",
    {
      outputSchema: getWeaponOutput,
      inputSchema: {
        weapon: z.string().min(1).max(200).describe("Weapon id or name."),
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async ({ weapon: reference, gameMode, priceSources: prices }, { read }) => {
      const { data, sources: priceSources, limits } = await loadBuildPricing(read, gameMode, prices);
      const notes: string[] = [];
      const weapon = resolveWeapon(data, reference, notes);
      let defaultPreset = null;
      if (weapon.defaultPresetId) {
        const contents = await read(() => getPreset(gameMode, weapon.defaultPresetId!));
        if (contents) {
          const root = reconstructPresetTree(weapon.id, contents, data.lookup);
          defaultPreset = {
            id: weapon.defaultPresetId,
            name: weapon.presets?.find((preset) => preset.id === weapon.defaultPresetId)?.name ?? null,
            stats: projectStats(
              computeStats(root, data.lookup, priceSources, null, { limits, preset: presetParts(weapon.id, contents, data.lookup) })
            ),
          };
        }
      }
      return {
        gameMode,
        id: weapon.id,
        name: weapon.name,
        shortName: weapon.shortName,
        url: itemUrl(context, weapon),
        caliber: formatCaliber(weapon.caliber),
        caliberId: caliberId(weapon.caliber),
        fireRate: weapon.fireRate ?? null,
        fireModes: weapon.fireModes ?? [],
        defaultAmmo: weapon.defaultAmmoName ?? null,
        baseStats: {
          ergonomics: weapon.ergonomics,
          recoilVertical: weapon.recoilVertical,
          recoilHorizontal: weapon.recoilHorizontal,
          weightKg: weapon.weight,
          priceRUB: effectivePrice(weapon, priceSources),
          ...(effectivePrice(weapon, priceSources) === null ? { priceNote: priceNote(weapon, priceSources, limits) } : {}),
        },
        presets: weapon.presets ?? [],
        defaultPreset,
        slots: weapon.slots.map((slot) => ({
          id: slot.id,
          nameId: slot.nameId,
          name: slot.name,
          required: slot.required,
          optionCount: slot.allowedItemIds.filter((id) => data.lookup.has(id)).length,
        })),
        compatibleAmmoCount: weapon.allowedAmmoIds?.length ?? 0,
        ...(notes.length ? { note: notes[0] } : {}),
      };
    }
  );

  define(
    "get_slot_options",
    {
      outputSchema: getSlotOptionsOutput,
      inputSchema: {
        build: buildInputSchema,
        slotPath: slotPathSchema,
        query: z.string().max(200).optional().describe("Filter parts by name."),
        sortBy: z.enum(["ergonomics", "recoil", "price", "name"]).default("ergonomics"),
        buyableOnly: buyableOnlySchema,
        limit: z.number().int().min(1).max(100).default(20),
        offset: offsetSchema,
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async ({ build: input, slotPath, query, sortBy, buyableOnly, limit, offset, gameMode, priceSources: prices }, { read }) => {
      const { data, sources: priceSources, limits } = await loadBuildPricing(read, gameMode, prices);
      const build = await resolveBuild(data, input);
      const target = resolveSlotPath(build.root, data.lookup, slotPath);
      const installed = installedOutside(build.root, target.current);
      let candidates = Array.from(new Set(target.slot.allowedItemIds)).flatMap((id) => {
        const item = data.lookup.get(id);
        return item ? [item] : [];
      });
      if (query?.trim()) {
        const ids = new Set(
          filterCatalog(asCatalog(candidates), query, [], candidates.length, candidates.length).map((match) => match.id)
        );
        candidates = candidates.filter((item) => ids.has(item.id));
      }
      const rows = candidates
        .map((item) => {
          // Most parts neither conflict nor are installed, so both are only stated when true.
          const conflict = conflictReason(item, target.slot.id, installed, data.lookup);
          return {
            ...itemRow(item, priceSources, limits),
            ...(conflict ? { conflict } : {}),
            ...(target.current?.itemId === item.id ? { installed: true as const } : {}),
          };
        })
        .filter((row) => !buyableOnly || row.priceRUB !== null);
      const price = (row: (typeof rows)[number]) => row.priceRUB ?? Number.POSITIVE_INFINITY;
      const sorted = rows.toSorted((a, b) => {
        if (sortBy === "ergonomics") return b.ergonomics - a.ergonomics || price(a) - price(b);
        if (sortBy === "recoil") return (a.recoilModifierPercent ?? 0) - (b.recoilModifierPercent ?? 0) || price(a) - price(b);
        if (sortBy === "price") return price(a) - price(b);
        return a.name.localeCompare(b.name);
      });
      const optionsPage = page(sorted, offset, limit);
      return {
        gameMode,
        slot: {
          id: target.slot.id,
          nameId: target.slot.nameId,
          name: target.slot.name,
          label: slotLabel(build.root, data.lookup, [...target.parentPath, target.slot.id]),
          required: target.slot.required,
          slotPath: [...target.parentPath, target.slot.id],
        },
        current: target.current ? itemName(data.lookup, target.current.itemId) : null,
        total: sorted.length,
        options: optionsPage.items,
        nextOffset: optionsPage.nextOffset,
        ...(build.warnings.length ? { warnings: build.warnings } : {}),
      };
    }
  );

  define(
    "get_ammo_options",
    {
      outputSchema: getAmmoOptionsOutput,
      inputSchema: {
        build: buildInputSchema,
        sortBy: z.enum(["penetration", "damage", "price", "recoil"]).default("penetration"),
        buyableOnly: buyableOnlySchema,
        limit: z.number().int().min(1).max(100).default(20),
        offset: offsetSchema,
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async ({ build: input, sortBy, buyableOnly, limit, offset, gameMode, priceSources: prices }, { read }) => {
      const { data, sources: priceSources, limits } = await loadBuildPricing(read, gameMode, prices);
      const build = await resolveBuild(data, input);
      const options = ammoOptions(build.root, data.lookup);
      const ammoIds = build.ammoId && !options.ids.includes(build.ammoId) ? [...options.ids, build.ammoId] : options.ids;
      const loaded = await data.loadAmmo(ammoIds);
      const loadedName = build.ammoId ? loaded.find((entry) => entry.id === build.ammoId)?.name ?? build.ammoId : null;
      const ammo = loaded
        .filter((entry) => options.ids.includes(entry.id))
        .map((entry) => projectAmmo(entry, priceSources, limits))
        .filter((row) => !buyableOnly || row.priceRUB !== null);
      const price = (row: (typeof ammo)[number]) => row.priceRUB ?? Number.POSITIVE_INFINITY;
      const sorted = ammo.toSorted((a, b) => {
        if (sortBy === "penetration") return b.penetration - a.penetration || b.totalDamage - a.totalDamage;
        if (sortBy === "damage") return b.totalDamage - a.totalDamage || b.penetration - a.penetration;
        if (sortBy === "price") return price(a) - price(b);
        return (a.recoilModifierPercent ?? 0) - (b.recoilModifierPercent ?? 0);
      });
      const ammoPage = page(sorted, offset, limit);
      return {
        gameMode,
        weapon: itemName(data.lookup, build.weaponId),
        source: options.source,
        magazine: itemName(data.lookup, options.magazineId),
        loaded: loadedName,
        total: sorted.length,
        ammo: ammoPage.items,
        nextOffset: ammoPage.nextOffset,
      };
    }
  );

  define(
    "evaluate_build",
    {
      outputSchema: evaluateBuildOutput,
      inputSchema: {
        build: buildInputSchema,
        includeShoppingList: z.boolean().default(false),
        includeDiscordText: z
          .boolean()
          .default(false)
          .describe("Include the shopping list formatted for Discord, as the app copies it."),
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async ({ build: input, includeShoppingList, includeDiscordText, gameMode, priceSources: prices }, { read }) => {
      const pricing = await loadBuildPricing(read, gameMode, prices);
      const { data, sources: priceSources, limits } = pricing;
      const build = await resolveBuild(data, input);
      const description = await describeBuild(context, pricing, build);
      const list =
        includeShoppingList || includeDiscordText
          ? buildShoppingList(build.root, data.lookup, priceSources, true, await purchaseContext(pricing, build.weaponId))
          : null;
      return {
        gameMode,
        ...description,
        ...(list && includeShoppingList
          ? {
              shoppingList: {
                totalRUB: Math.round(list.totalRUB),
                itemCount: list.itemCount,
                unpricedCount: list.unpricedCount,
                rows: list.rows.map((row) => ({
                  name: row.name,
                  count: row.count,
                  ...(row.withWeapon ? { withWeapon: row.withWeapon } : {}),
                  source: row.source,
                  unitPriceRUB: row.unitPriceRUB,
                  subtotalRUB: row.subtotalRUB,
                  trader:
                    row.source === "flea"
                      ? null
                      : row.offer
                        ? offerLabel(row.offer)
                        : row.source === "trader" && row.traderName
                          ? traderLabel(row.traderName, row.traderLevel)
                          : null,
                  ...(row.offer?.taskUnlock ? { taskUnlock: row.offer.taskUnlock } : {}),
                })),
              },
            }
          : {}),
        ...(list && includeDiscordText
          ? {
              discordText: formatShoppingList(list, {
                buildName: build.name,
                weaponName: itemName(data.lookup, build.weaponId),
                modeLabel: gameMode === "pve" ? "PVE" : "PVP",
              }),
            }
          : {}),
        ...(build.warnings.length ? { warnings: build.warnings } : {}),
      };
    }
  );

  define(
    "modify_build",
    {
      outputSchema: modifyBuildOutput,
      inputSchema: {
        build: buildInputSchema,
        changes: z
          .array(buildChangeInput)
          .min(1)
          .max(40)
          .describe("Changes applied in order."),
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async ({ build: input, changes, gameMode, priceSources: prices }, { read }) => {
      const pricing = await loadBuildPricing(read, gameMode, prices);
      const { data, sources: priceSources } = pricing;
      const build = await resolveBuild(data, input);
      const bought = await purchaseContext(pricing, build.weaponId);
      const applied: string[] = [];
      let root = build.root;
      let ammoId = build.ammoId;
      const deadline = optimizerDeadline(context);
      for (const change of changes) {
        if (change.action === "install") {
          const installed = installPart(root, data.lookup, change.slotPath, change.item, data.budget);
          root = installed.root;
          applied.push(
            `Installed ${installed.part.name} in ${installed.label}${installed.replaced ? ` (replacing ${itemName(data.lookup, installed.replaced.itemId)})` : ""}${installed.conflict ? `. Warning: ${installed.conflict}.` : "."}${installed.note ? ` ${installed.note}` : ""}`
          );
        } else if (change.action === "remove") {
          const target = resolveSlotPath(root, data.lookup, change.slotPath);
          const path = [...target.parentPath, target.slot.id];
          const label = slotLabel(root, data.lookup, path);
          if (target.current) {
            applied.push(`Removed ${itemName(data.lookup, target.current.itemId)} from ${label}.`);
            root = removeMod(root, path);
          } else {
            applied.push(`${label} was already empty.`);
          }
        } else if (change.action === "fill_required") {
          const target = change.slotPath ? resolveSlotPath(root, data.lookup, change.slotPath) : null;
          const result = await runOptimizer(
            root,
            data.lookup,
            {
              goal: "cost",
              priceSources,
              ...bought,
              replaceExisting: false,
              target: target ? { parentPath: target.parentPath, slotId: target.slot.id } : null,
              ammoId,
            },
            deadline,
            context
          );
          const before = new Set(collectPaths(root));
          const added = collectPaths(result.root).filter((path) => !before.has(path)).length;
          applied.push(
            result.changed
              ? `Filled ${target ? slotLabel(root, data.lookup, [...target.parentPath, target.slot.id]) : "empty required slots"} with ${added} cheapest part${added === 1 ? "" : "s"}.`
              : "No priced part from the selected sources fits the empty required slots."
          );
          root = result.root;
        } else if (change.action === "set_ammo") {
          const { ammo, fits, note } = await resolveAmmo(data, root, (change.item ?? change.ammo)!);
          ammoId = ammo.id;
          applied.push(
            `Loaded ${ammo.name}${fits ? "." : ". Warning: it does not fit this build's magazine or chamber."}${note ? ` ${note}` : ""}`
          );
        } else {
          ammoId = null;
          applied.push("Cleared the ammo.");
        }
      }
      const description = await describeBuild(context, pricing, { ...build, root, ammoId });
      return {
        gameMode,
        applied,
        ...description,
        ...(build.warnings.length ? { warnings: build.warnings } : {}),
      };
    }
  );

  define(
    "optimize_build",
    {
      outputSchema: optimizeBuildOutput,
      inputSchema: {
        build: buildInputSchema,
        goal: z.enum(["ergonomics", "recoil", "cost"]),
        budgetRUB: z.number().int().min(0).max(1_000_000_000).optional().describe("Maximum total cost including the weapon."),
        keepInstalledParts: z.boolean().default(false),
        allowUnpriced: z
          .boolean()
          .default(false)
          .describe("Allow parts with no price from the selected sources (ignored for the cost goal)."),
        minMagazineCapacity: z
          .number()
          .int()
          .min(0)
          .max(1_000)
          .optional()
          .describe("Smallest magazine allowed. Defaults to the installed magazine's capacity; 0 allows any."),
        keepSights: z
          .boolean()
          .default(true)
          .describe("Replace a sight only with one of the same kind (optic, rear, or front sight)."),
        slotPath: slotPathSchema.optional().describe("Only optimise this slot and what attaches to it."),
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async (
      {
        build: input,
        goal,
        budgetRUB,
        keepInstalledParts,
        allowUnpriced,
        minMagazineCapacity,
        keepSights,
        slotPath,
        gameMode,
        priceSources: prices,
      },
      { read }
    ) => {
      const pricing = await loadBuildPricing(read, gameMode, prices);
      const { data, sources: priceSources } = pricing;
      const build = await resolveBuild(data, input);
      const target = slotPath ? resolveSlotPath(build.root, data.lookup, slotPath) : null;
      const bought = await purchaseContext(pricing, build.weaponId);
      const result = await runOptimizer(
        build.root,
        data.lookup,
        {
          goal: goal as OptimizeGoal,
          priceSources,
          ...bought,
          budget: budgetRUB ?? null,
          replaceExisting: !keepInstalledParts,
          allowUnpriced,
          target: target ? { parentPath: target.parentPath, slotId: target.slot.id } : null,
          ammoId: build.ammoId,
          keepSights,
          ...(minMagazineCapacity === undefined ? {} : { minMagazineCapacity: minMagazineCapacity || null }),
        },
        optimizerDeadline(context),
        context
      );
      const ammo = build.ammoId ? (await data.loadAmmo([build.ammoId]))[0] ?? null : null;
      const before = computeStats(build.root, data.lookup, priceSources, ammo, bought);
      const after = computeStats(result.root, data.lookup, priceSources, ammo, bought);
      // Optimising an optimised build replaces the goal in its name instead of stacking another.
      const name = input.name?.trim() || `${build.name.replace(/ \((?:ergonomics|recoil|cost)\)$/, "")} (${goal})`;
      const description = await describeBuild(context, pricing, { ...build, root: result.root, name });
      const overBudget = budgetRUB !== undefined && !result.withinBudget;
      const weapon = data.lookup.get(build.weaponId);
      const weaponPrice = weapon ? effectivePrice(weapon, priceSources) : null;
      const cheapest = Math.round(result.costRUB);
      return {
        gameMode,
        goal,
        changed: result.changed,
        withinBudget: result.withinBudget,
        ...(overBudget
          ? {
              minimumCostRUB: cheapest,
              notice: `The budget of ${formatRoubles(budgetRUB)} can't be met: the cheapest build the optimiser found costs ${formatRoubles(cheapest)}${weaponPrice === null ? "" : ` (the weapon alone costs ${formatRoubles(weaponPrice)})`}. This is that build; raise the budget to at least ${formatRoubles(cheapest)}, or allow more price sources or trader levels.`,
            }
          : {}),
        remainingConflicts: result.conflicts,
        changes: diffBuildTrees(build.root, result.root, data.lookup)
          .filter((row) => row.status !== "same")
          .map((row) => ({
            slot: [...row.context, row.label].join(" / "),
            status: row.status,
            before: itemName(data.lookup, row.left),
            after: itemName(data.lookup, row.right),
          })),
        statChanges: statDeltas(before, after).map((delta) => ({
          stat: delta.label,
          before: round(delta.left, 2),
          after: round(delta.right, 2),
          change: delta.delta,
          verdict: delta.verdict,
        })),
        ...description,
        ...(build.warnings.length ? { warnings: build.warnings } : {}),
      };
    }
  );

  define(
    "compare_builds",
    {
      outputSchema: compareBuildsOutput,
      inputSchema: {
        left: buildInputSchema,
        right: buildInputSchema,
        includeUnchangedSlots: z.boolean().default(false),
        gameMode: gameModeSchema,
        priceSources: priceSourcesSchema,
      },
    },
    async ({ left: leftInput, right: rightInput, includeUnchangedSlots, gameMode, priceSources: prices }, { read }) => {
      const pricing = await loadBuildPricing(read, gameMode, prices);
      const { data, sources: priceSources } = pricing;
      const [left, right] = await Promise.all([
        resolveBuild(data, leftInput),
        resolveBuild(data, rightInput),
      ]);
      const [leftBought, rightBought] = await Promise.all([
        purchaseContext(pricing, left.weaponId),
        purchaseContext(pricing, right.weaponId),
      ]);
      const ammoIds = [left.ammoId, right.ammoId].filter((id): id is string => Boolean(id));
      const ammo = new Map(
        (ammoIds.length ? await data.loadAmmo(ammoIds) : []).map((entry) => [entry.id, entry])
      );
      const leftStats = computeStats(left.root, data.lookup, priceSources, ammo.get(left.ammoId ?? "") ?? null, leftBought);
      const rightStats = computeStats(right.root, data.lookup, priceSources, ammo.get(right.ammoId ?? "") ?? null, rightBought);
      return {
        gameMode,
        left: { name: left.name, weapon: itemName(data.lookup, left.weaponId), ammo: ammo.get(left.ammoId ?? "")?.name ?? null },
        right: { name: right.name, weapon: itemName(data.lookup, right.weaponId), ammo: ammo.get(right.ammoId ?? "")?.name ?? null },
        stats: statDeltas(leftStats, rightStats).map((delta) => ({
          stat: delta.label,
          left: round(delta.left, 2),
          right: round(delta.right, 2),
          difference: delta.delta,
          better: delta.better,
          rightIs: delta.verdict,
        })),
        slots: diffBuildTrees(left.root, right.root, data.lookup)
          .filter((row) => includeUnchangedSlots || row.status !== "same")
          .map((row) => ({
            slot: [...row.context, row.label].join(" / "),
            status: row.status,
            left: itemName(data.lookup, row.left),
            right: itemName(data.lookup, row.right),
          })),
        ...(left.warnings.length || right.warnings.length
          ? { warnings: [...left.warnings.map((w) => `Left: ${w}`), ...right.warnings.map((w) => `Right: ${w}`)] }
          : {}),
      };
    }
  );
}
