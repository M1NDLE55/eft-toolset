import { z } from "zod";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILD_TREE_DEPTH, MAX_BUILD_TREE_NODES } from "@/app/lib/builds/limits";
import { MAX_SHARE_LINK_LENGTH } from "@/app/lib/share-codec";

// Published schemas are read by every client before each conversation, so descriptions say
// only what a caller needs to get a call right; the server instructions explain the rest, and
// validation errors explain limits.

export const gameModeSchema = z.enum(["regular", "pve"]).default("regular");

export const priceSourcesSchema = z
  .object({
    traders: z.boolean().default(true),
    flea: z.boolean().default(true),
    maxTraderLevel: z.number().int().min(1).max(4).optional().describe("Loyalty level with every trader."),
    traderLevels: z
      .record(z.string().max(40), z.number().int().min(0).max(4))
      .refine((levels) => Object.keys(levels).length <= 20, "At most 20 traders.")
      .optional()
      .describe('Overrides maxTraderLevel, e.g. {"Jaeger": 0} (0 = locked).'),
  })
  .default({ traders: true, flea: true })
  .describe("Where parts can be bought; each costs its cheapest allowed offer.");

const slotPathEntries = z.array(z.string().min(1).max(160)).min(1).max(MAX_BUILD_TREE_DEPTH);

export const slotPathSchema = slotPathEntries.describe(
  'Slots from the weapon down: slot ids, name ids like "mod_muzzle", or names like "Muzzle".'
);

const BUILD_SHAPE =
  'A build is {"shareLink": ...} or {"weapon": ..., "preset"?: ..., "parts"?: [{"slotPath": [...], "item": ...}]}, each with optional "ammo" and "name".';

/**
 * A build: a share link, or a weapon with an optional preset and parts. One object with a
 * check, rather than a union of two, publishes each field once; it accepts exactly what the
 * union did.
 */
export const buildInputSchema = z
  .strictObject(
    {
      shareLink: z.string().min(1).max(MAX_SHARE_LINK_LENGTH).optional().describe("A build share link; or give weapon."),
      weapon: z.string().min(1).max(200).optional().describe("Weapon id or name."),
      preset: z.string().min(1).max(200).optional().describe('"default", or a preset id or name.'),
      parts: z
        .array(z.object({ slotPath: slotPathEntries, item: z.string().min(1).max(200) }))
        .max(MAX_BUILD_TREE_NODES)
        .optional()
        .describe("Parts to install: slotPath from the weapon down, item id or name (a build result's parts fit)."),
      ammo: z.string().min(1).max(200).optional().describe("Ammo id or name."),
      name: z.string().max(MAX_BUILD_NAME_LENGTH).optional(),
    },
    { error: BUILD_SHAPE }
  )
  .superRefine((build, context) => {
    const fromLink = build.shareLink !== undefined;
    if (fromLink === (build.weapon !== undefined) || (fromLink && (build.preset !== undefined || build.parts !== undefined))) {
      context.addIssue({ code: "custom", message: BUILD_SHAPE });
    }
  });

export const offsetSchema = z.number().int().min(0).max(10_000).default(0).describe("Skip this many results; use nextOffset.");

/** One page of rows, with the offset of the next page or null on the last one. */
export function page<T>(rows: readonly T[], offset: number, limit: number) {
  const end = offset + limit;
  return { items: rows.slice(offset, end), nextOffset: end < rows.length ? end : null };
}
