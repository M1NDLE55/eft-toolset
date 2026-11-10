import { z } from "zod";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILD_TREE_DEPTH, MAX_BUILD_TREE_NODES } from "@/app/lib/builds/limits";
import { MAX_SHARE_LINK_LENGTH } from "@/app/lib/share-codec";

export const gameModeSchema = z.enum(["regular", "pve"]).default("regular").describe('"regular" (PVP) or "pve".');

export const priceSourcesSchema = z
  .object({
    traders: z.boolean().default(true),
    flea: z.boolean().default(true),
    maxTraderLevel: z.number().int().min(1).max(4).optional().describe("Loyalty level with all traders."),
    traderLevels: z
      .record(z.string().max(40), z.number().int().min(0).max(4))
      .refine((levels) => Object.keys(levels).length <= 20, "At most 20 traders.")
      .optional()
      .describe('Per-trader levels over maxTraderLevel, e.g. {"Jaeger": 0} (0 = locked).'),
  })
  .default({ traders: true, flea: true })
  .describe("Price sources to count; each part costs its cheapest enabled source within the trader levels.");

export const slotPathSchema = z
  .array(z.string().min(1).max(160))
  .min(1)
  .max(MAX_BUILD_TREE_DEPTH)
  .describe('Slots from the weapon down: slot ids, name ids like "mod_muzzle", or names like "Muzzle".');

const buildExtras = {
  ammo: z.string().min(1).max(200).optional().describe("Ammo id or name to load."),
  name: z.string().max(MAX_BUILD_NAME_LENGTH).optional(),
};

export const buildInputSchema = z
  .union(
    [
      z.strictObject({
        shareLink: z.string().min(1).max(MAX_SHARE_LINK_LENGTH).describe("A gun builder share link or its payload."),
        ...buildExtras,
      }),
      z.strictObject({
        weapon: z.string().min(1).max(200).describe("Weapon id or name."),
        preset: z.string().min(1).max(200).optional().describe('"default", or a preset id or name from get_weapon.'),
        parts: z
          .array(z.object({ slotPath: slotPathSchema, item: z.string().min(1).max(200).describe("Part id or name.") }))
          .max(MAX_BUILD_TREE_NODES)
          .optional()
          .describe("Parts to install, such as the slotPath and itemId of each entry in a build result's parts."),
        ...buildExtras,
      }),
    ],
    {
      error:
        'A build is {"shareLink": ...} or {"weapon": ..., "preset"?: ..., "parts"?: [{"slotPath": [...], "item": ...}]}, each with optional "ammo" and "name".',
    }
  )
  .describe("A share link from any build tool, or a weapon with an optional preset and parts.");

export const offsetSchema = z.number().int().min(0).max(10_000).default(0).describe("Skip this many results; use nextOffset.");

/** One page of rows, with the offset of the next page or null on the last one. */
export function page<T>(rows: readonly T[], offset: number, limit: number) {
  const end = offset + limit;
  return { items: rows.slice(offset, end), nextOffset: end < rows.length ? end : null };
}
