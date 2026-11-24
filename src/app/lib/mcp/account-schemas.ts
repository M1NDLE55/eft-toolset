import { z } from "zod";

// Output schemas for the account tools (see output-schemas.ts for the conventions: objects stay
// open, and tools/list publishes only the top level).
const object = z.looseObject;
const text = z.string();
const num = z.number();
const bool = z.boolean();
const list = <T extends z.ZodType>(entry: T) => z.array(entry);
const warnings = list(text).optional();
const counts = object({ ownedPlans: num, sharedPlans: num, builds: num, itemGroups: num });

export const listLibraryOutput = object({
  builds: list(object({ id: text, name: text, weaponId: text, version: num, allowCopy: bool, url: text })).optional(),
  itemGroups: list(object({ id: text, name: text, items: num, version: num, allowCopy: bool, url: text })).optional(),
  raidPlans: list(object({ id: text, name: text, map: text, role: text, relation: text, rev: num, url: text }).nullable()).optional(),
  usage: counts,
  limits: counts,
  nextOffset: num.nullable(),
});

export const saveToLibraryOutput = object({
  id: text,
  version: num,
  url: text,
  merged: bool.optional().describe("Another device's edit to other fields was kept."),
  restored: bool.optional().describe("It had been deleted elsewhere; the edit brought it back."),
  itemMatches: list(object({ input: text, item: text.nullable() })).optional(),
  warnings,
});

export const accountResultOutput = object({
  done: bool,
  message: text.optional(),
  id: text.optional(),
  role: text.optional(),
  url: text.optional(),
  expiresAt: text.nullable().optional(),
});

export const listLinksOutput = object({
  links: list(object({ url: text, access: text, status: text, role: text.optional(), opens: num.optional(), copies: num.optional(), uses: num.optional(), maxUses: num.nullable().optional(), expiresAt: text.nullable() })),
});

export const openLinkOutput = object({
  kind: z.enum(["build", "item_group", "raid_plan", "invite"]),
  can: list(text).describe("What you may do with it: view, copy, edit or join."),
  name: text,
  owner: text.optional(),
  role: text.optional(),
  map: text.optional(),
  invitedBy: text.optional(),
  expiresAt: text.nullable().optional(),
  shareLink: text.optional(),
  items: list(text).optional(),
  plan: object({}).optional(),
  note: text.optional(),
});

export const editRaidPlanOutput = object({
  rev: num,
  url: text,
  created: list(object({ op: num, id: text })).describe("The id of each item the ops added, by op index."),
  resolvedPlaces: list(object({ input: text, resolved: text })).optional(),
  warnings,
});

export const membersOutput = object({
  members: list(object({ key: text, name: text, role: text, you: bool, online: bool, viaAI: bool.optional() })),
  anonymousViewers: num,
});
