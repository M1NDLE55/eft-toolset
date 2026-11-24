import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { planObject, userObject } from "@/app/lib/durable/access";
import { DomainError } from "@/app/lib/durable/sql";
import { resolveBuild } from "@/app/lib/builds/resolve";
import { encodeBuildSharePayload, slugifyBuildName } from "@/app/lib/builds/share";
import { parseSharedBuildInput } from "@/app/lib/builds/share-import";
import { diffBuild } from "@/app/lib/sharing/build-patch";
import { diffGroup } from "@/app/lib/sharing/group-patch";
import { newOperationId, newRecordId } from "@/app/lib/sharing/ids";
import { compareOrder, keyBetween } from "@/app/lib/sharing/order-key";
import { contentOf, type PlanDoc, type PlanOp } from "@/app/lib/sharing/plan-doc";
import type { BuildRecord, BuildValue, GroupRecord } from "@/app/lib/sharing/types";
import { matchItemReference } from "@/app/lib/search/item-reference";
import { getMapConfig, mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { decodePlanLink, nearestPlace } from "@/app/lib/raid-planner/resolve";
import { PLAN_COLORS, type GamePoint } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { TarkovUpstreamError } from "@/app/lib/api/tarkov-server";
import {
  copyFromLink,
  createLink,
  libraryUrl,
  listLinks,
  openShare,
  resolveCode,
  revokeLink,
} from "@/app/lib/sharing/server/link-routes";
import {
  acceptInvite,
  applyPlanOps,
  createAccountPlan,
  destroyPlan,
  leavePlan,
  previewInvite,
  removeMember,
  setMemberRole,
  setPlanAllowCopy,
  transferPlan,
} from "@/app/lib/sharing/server/plan-service";
import { fileReport } from "@/app/lib/sharing/server/report-routes";
import { InputError, type GameMode, type Read, type ToolContext } from "./context";
import { env, mutate, parseLink, planIdOf, recordUrl, requestRef, userOf } from "./account-access";
import { toolDefiner } from "./define-tool";
import { gameModeSchema, offsetSchema, buildInputSchema } from "./schemas";
import { loadBuildSource, loadCatalogIndex, loadMapDetails } from "./sources";
import { echo, fuzzyBudget, isInexact } from "./item-match";
import { createPlaceResolver, pointSchema, type PointInput } from "./raid-planner";
import {
  accountResultOutput,
  editRaidPlanOutput,
  listLibraryOutput,
  listLinksOutput,
  membersOutput,
  openLinkOutput,
  saveToLibraryOutput,
} from "./account-schemas";

/**
 * The account tools (§13): an agent signed in as a user does everything that user can on the site,
 * through the same UserDO and PlanDO methods as the HTTP routes, so it has exactly their permissions
 * and limits. Library writes are mutations with versions, like any other device's.
 */

const PAGE = 50;

/** A build given by saved id or /s/ link, as the recipe link the gun-builder tools take. */
export async function expandBuildInput<T extends { shareLink?: string; savedBuildId?: string }>(context: ToolContext, input: T): Promise<Omit<T, "savedBuildId">> {
  let value: BuildValue | null = null;
  if (input.savedBuildId) {
    const record = await userObject(env(), userOf(context)).record("build", input.savedBuildId);
    if (!record || record.kind !== "build" || record.deleted) throw new InputError("No saved build has that id. list_library lists them.");
    value = record;
  } else if (input.shareLink && /\/s\/[1-9A-Za-z][A-Za-z0-9_-]{20}/.test(input.shareLink)) {
    const parsed = parseLink(input.shareLink);
    if (parsed.kind !== "share") throw new InputError("That isn't a build link.");
    const shared = await openShare(env(), parsed.code, context.userId ?? null);
    if (shared.targetType !== "build") throw new InputError("That link is to something other than a build.");
    value = shared.snapshot as BuildValue;
  }
  if (!value) {
    const { savedBuildId: _saved, ...rest } = input;
    void _saved;
    return rest;
  }
  const now = Date.now();
  const payload = await encodeBuildSharePayload({ id: "mcp", name: value.name, weaponId: value.weaponId, root: value.root, ...(value.ammoId ? { ammoId: value.ammoId } : {}), createdAt: now, updatedAt: now });
  const { savedBuildId: _saved, ...rest } = input;
  void _saved;
  return { ...rest, shareLink: `${context.origin}/gun-builder/share/${slugifyBuildName(value.name)}#b=${payload}` };
}

/** saveTo: writes a build tool's result back to a saved build (owner only), as a patch that merges. */
export async function saveBuildTo(context: ToolContext, saveTo: { id: string; baseVersion?: number; requestId?: string }, build: { name: string; weaponId: string; root: BuildValue["root"]; ammoId: string | null }) {
  const userId = userOf(context);
  const record = await userObject(env(), userId).record("build", saveTo.id);
  if (!record || record.kind !== "build") throw new InputError("No saved build has that id.");
  if (record.weaponId !== build.weaponId) throw new InputError("A saved build's weapon can't change; save it as a new build instead.");
  const next = { ...record, root: build.root, ...(build.ammoId ? { ammoId: build.ammoId } : { ammoId: undefined }) };
  const patch = diffBuild(record, next);
  if (!patch) return { id: record.id, version: record.version, url: recordUrl(context.origin, record), unchanged: true };
  const result = await mutate(userId, { mutationId: requestRef(saveTo.requestId), kind: "build", op: "patch", id: record.id, baseVersion: saveTo.baseVersion ?? record.version, patch });
  return { id: record.id, version: result.version, url: recordUrl(context.origin, result.record), ...(result.merged ? { merged: true } : {}), ...(result.restored ? { restored: true } : {}) };
}

async function matchItems(read: Read, gameMode: GameMode, references: string[], context: ToolContext) {
  if (references.length === 0) return { names: [] as string[], itemMatches: [] as { input: string; item: string | null }[] };
  const index = await loadCatalogIndex(read, gameMode);
  const budget = fuzzyBudget();
  const names: string[] = [];
  const itemMatches: { input: string; item: string | null; matchedBy?: string }[] = [];
  for (const reference of references) {
    if (context.signal.aborted) break;
    const match = matchItemReference(index, reference, { budget });
    if (match.status !== "found") {
      itemMatches.push({ input: echo(reference), item: null });
      continue;
    }
    itemMatches.push({ input: echo(reference), item: match.item.name, ...(isInexact(match) ? { matchedBy: match.matchedBy } : {}) });
    if (!names.includes(match.item.name)) names.push(match.item.name);
  }
  return { names, itemMatches };
}

// Raid plan ops in agent-friendly form (§13.1)

const targetSchema = z
  .union([z.string().min(1).max(64), z.object({ nearest: z.string().min(1).max(200) })])
  .describe('An item id, or {"nearest": <place>} for the waypoint or note nearest a place.');

const AGENT_OPS = [
  "add_waypoint",
  "move_waypoint",
  "delete_waypoint",
  "add_drawing",
  "delete_drawing",
  "add_note",
  "move_note",
  "set_note_color",
  "set_note_text",
  "delete_note",
  "show_layer",
  "hide_layer",
  "rename",
] as const;

/** Which fields each op needs; one flat object publishes far smaller than a union of thirteen. */
const NEEDS: Record<(typeof AGENT_OPS)[number], readonly string[]> = {
  add_waypoint: ["at"],
  move_waypoint: ["target", "to"],
  delete_waypoint: ["target"],
  add_drawing: ["kind", "points"],
  delete_drawing: ["id"],
  add_note: ["at", "title"],
  move_note: ["target", "to"],
  set_note_color: ["target", "color"],
  set_note_text: ["target"],
  delete_note: ["target"],
  show_layer: ["layer"],
  hide_layer: ["layer"],
  rename: ["name"],
};

const agentOpSchema = z
  .object({
    op: z.enum(AGENT_OPS),
    at: pointSchema.optional().describe("Where to add."),
    to: pointSchema.optional().describe("Where to move."),
    target: targetSchema.optional(),
    insertAfter: z.string().max(64).default("end").describe('add_waypoint: a waypoint id, "start" or "end".'),
    id: z.string().max(64).optional().describe("delete_drawing: its id."),
    kind: z.enum(["pen", "arrow"]).optional(),
    points: z.array(pointSchema).min(2).max(2000).optional(),
    color: z.string().max(20).optional(),
    title: z.string().max(120).optional(),
    body: z.string().max(1000).optional(),
    expectRev: z.number().int().min(0).optional().describe("set_note_text: the note's textRev; omitted, last writer wins."),
    layer: z.string().max(120).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .superRefine((op, context) => {
    for (const field of NEEDS[op.op]) {
      if ((op as Record<string, unknown>)[field] === undefined) context.addIssue({ code: "custom", message: `${op.op} needs ${field}.` });
    }
  });
type AgentOp = z.output<typeof agentOpSchema>;

async function memberSnapshot(userId: string, planId: string) {
  const result = await planObject(env(), planId).snapshot(userId);
  if (!result.ok) throw new DomainError(result.error.code, result.error.message, result.error.details);
  return result.value;
}

async function mapDetailsFor(read: Read, gameMode: GameMode, mapKey: string, warnings: string[]): Promise<MapDetails | null> {
  const config = getMapConfig(mapKey);
  if (!config) return null;
  try {
    return await loadMapDetails(read, gameMode, config);
  } catch (error) {
    if (!(error instanceof TarkovUpstreamError || error instanceof InputError)) throw error;
    warnings.push("Map data is unavailable, so place names can't be used and nearby places aren't named.");
    return null;
  }
}

/** Turns agent ops into PlanOps against the current document (ids, order keys, text bases). */
function toPlanOps(doc: PlanDoc, ops: AgentOp[], resolver: ReturnType<typeof createPlaceResolver>, created: { op: number; id: string }[], warnings: string[]): PlanOp[] {
  const out: PlanOp[] = [];
  const working = { waypoints: { ...doc.waypoints }, notes: { ...doc.notes } };
  const pick = (target: string | { nearest: string }, kind: "wp" | "note", where: string): string => {
    if (typeof target === "string") return target;
    const at = resolver.toPoint({ place: target.nearest }, where);
    const rows = kind === "wp" ? Object.values(working.waypoints) : Object.values(working.notes);
    let best: { id: string; distance: number } | null = null;
    for (const row of rows) {
      const distance = Math.hypot(row.x - at.x, row.z - at.z);
      if (!best || distance < best.distance) best = { id: row.id, distance };
    }
    if (!best) {
      resolver.problems.push(`${where}: the plan has no ${kind === "wp" ? "waypoints" : "notes"}.`);
      return "missing";
    }
    if (best.distance > 50) warnings.push(`${where}: the nearest ${kind === "wp" ? "waypoint" : "note"} to ${target.nearest} is ${Math.round(best.distance)} m away.`);
    return best.id;
  };
  ops.forEach((op, index) => {
    const where = `ops[${index}]`;
    switch (op.op) {
      case "add_waypoint": {
        const ordered = Object.values(working.waypoints).sort(compareOrder);
        let previous: string | null = null;
        let next: string | null = null;
        if (op.insertAfter === "start") next = ordered[0]?.ord ?? null;
        else if (op.insertAfter === "end") previous = ordered.at(-1)?.ord ?? null;
        else {
          const position = ordered.findIndex((waypoint) => waypoint.id === op.insertAfter);
          if (position === -1) resolver.problems.push(`${where}: no waypoint ${op.insertAfter}.`);
          previous = ordered[position]?.ord ?? null;
          next = ordered[position + 1]?.ord ?? null;
        }
        const id = newRecordId();
        const ord = keyBetween(previous, next);
        const at = resolver.toPoint(op.at! as PointInput, `${where}.at`);
        working.waypoints[id] = { id, ord, ...at, rev: 0, by: null };
        created.push({ op: index, id });
        out.push({ t: "wp.add", id, at, ord });
        return;
      }
      case "move_waypoint":
        out.push({ t: "wp.move", id: pick(op.target!, "wp", where), at: resolver.toPoint(op.to! as PointInput, `${where}.to`) });
        return;
      case "delete_waypoint":
        out.push({ t: "wp.del", id: pick(op.target!, "wp", where) });
        return;
      case "add_drawing": {
        const id = newRecordId();
        created.push({ op: index, id });
        out.push({ t: "draw.add", id, kind: op.kind!, color: resolver.colorOf(op.color, PLAN_COLORS[3]), points: op.points!.map((point, pointIndex) => resolver.toPoint(point as PointInput, `${where}.points[${pointIndex}]`)) });
        return;
      }
      case "delete_drawing":
        out.push({ t: "draw.del", id: op.id! });
        return;
      case "add_note": {
        const id = newRecordId();
        const at = resolver.toPoint(op.at! as PointInput, `${where}.at`);
        const body = op.body ?? "";
        working.notes[id] = { id, ...at, title: op.title!, body, color: "", titleRev: 0, bodyRev: 0, rev: 0, by: null };
        created.push({ op: index, id });
        out.push({ t: "note.add", id, at, title: op.title!, body, color: resolver.colorOf(op.color, PLAN_COLORS[0]) });
        return;
      }
      case "move_note":
        out.push({ t: "note.move", id: pick(op.target!, "note", where), at: resolver.toPoint(op.to! as PointInput, `${where}.to`) });
        return;
      case "set_note_color":
        out.push({ t: "note.color", id: pick(op.target!, "note", where), color: resolver.colorOf(op.color, PLAN_COLORS[0]) });
        return;
      case "set_note_text": {
        const id = pick(op.target!, "note", where);
        const note = doc.notes[id];
        if (op.expectRev === undefined) warnings.push(`${where}: no expectRev, so this text replaces whatever the note says now.`);
        for (const field of ["title", "body"] as const) {
          const value = op[field];
          if (value === undefined) continue;
          const current = note ? (field === "title" ? note.titleRev : note.bodyRev) : 0;
          out.push({ t: "note.text", id, field, value, base: op.expectRev ?? current });
        }
        return;
      }
      case "delete_note":
        out.push({ t: "note.del", id: pick(op.target!, "note", where) });
        return;
      case "show_layer":
      case "hide_layer":
        out.push({ t: op.op === "show_layer" ? "layer.on" : "layer.off", layer: op.layer! });
        return;
      case "rename":
        out.push({ t: "plan.rename", name: op.name! });
        return;
    }
  });
  return out;
}

/** An account plan as read_raid_plan describes it, with ids and revisions for edit_raid_plan. */
export async function describeAccountPlan(context: ToolContext, read: Read, gameMode: GameMode, planId: string) {
  const userId = userOf(context);
  const snapshot = await memberSnapshot(userId, planId);
  const warnings: string[] = [];
  const details = await mapDetailsFor(read, gameMode, snapshot.doc.mapKey, warnings);
  const config = getMapConfig(snapshot.doc.mapKey);
  const resolver = config ? createPlaceResolver(config, details, []) : null;
  const near = (point: GamePoint) => (resolver && config ? nearestPlace(resolver.places, point, config) : null);
  const content = contentOf(snapshot.doc);
  return {
    planId,
    url: `${context.origin}/raid-planner/p/${planId}`,
    rev: snapshot.rev,
    role: snapshot.role,
    allowCopy: snapshot.allowCopy,
    members: (snapshot.members ?? []).map((member) => ({ name: member.displayName, role: member.role, key: member.key, you: member.you })),
    content,
    route: content.route.map((waypoint, index) => ({ id: waypoint.id, step: index + 1, x: waypoint.position.x, z: waypoint.position.z, near: near(waypoint.position) })),
    notes: Object.values(snapshot.doc.notes).map((note) => ({ id: note.id, title: note.title, body: note.body, x: note.x, z: note.z, near: near(note), textRev: Math.max(note.titleRev, note.bodyRev), titleRev: note.titleRev, bodyRev: note.bodyRev })),
    drawings: Object.values(snapshot.doc.drawings).map((drawing) => ({ id: drawing.id, kind: drawing.kind, points: drawing.points.length })),
    warnings,
  };
}

export function registerAccountTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  const write = { readOnlyHint: false, idempotentHint: false, openWorldHint: false } as const;
  const readOnly = { openWorldHint: false } as const;

  define(
    "list_library",
    {
      outputSchema: listLibraryOutput,
      annotations: readOnly,
      inputSchema: {
        type: z.enum(["build", "item_group", "raid_plan"]).optional().describe("Default: everything."),
        offset: offsetSchema,
      },
    },
    async ({ type, offset }) => {
      const library = await userObject(env(), userOf(context)).library();
      const pick = <T,>(rows: T[]) => rows.slice(offset, offset + PAGE);
      const builds = library.records.filter((record): record is BuildRecord => record.kind === "build");
      const groups = library.records.filter((record): record is GroupRecord => record.kind === "item_group");
      const plans = library.records.filter((record) => record.kind === "plan" && record.status === "active");
      const longest = Math.max(type && type !== "build" ? 0 : builds.length, type && type !== "item_group" ? 0 : groups.length, type && type !== "raid_plan" ? 0 : plans.length);
      return {
        ...(!type || type === "build"
          ? { builds: pick(builds).map((build) => ({ id: build.id, name: build.name, weaponId: build.weaponId, version: build.version, allowCopy: build.allowCopy, url: recordUrl(context.origin, build) })) }
          : {}),
        ...(!type || type === "item_group"
          ? { itemGroups: pick(groups).map((group) => ({ id: group.id, name: group.name, items: group.items.length, version: group.version, allowCopy: group.allowCopy, url: recordUrl(context.origin, group) })) }
          : {}),
        ...(!type || type === "raid_plan"
          ? {
              raidPlans: pick(plans).map((plan) =>
                plan.kind === "plan"
                  ? { id: plan.id, name: plan.name ?? "", map: plan.mapKey ?? "", role: plan.role, relation: plan.relation, rev: plan.rev ?? 0, url: `${context.origin}/raid-planner/p/${plan.id}` }
                  : null
              ),
            }
          : {}),
        usage: { ...library.usage },
        limits: { ...library.limits },
        nextOffset: offset + PAGE < longest ? offset + PAGE : null,
      };
    }
  );

  define(
    "save_to_library",
    {
      outputSchema: saveToLibraryOutput,
      annotations: write,
      inputSchema: {
        type: z.enum(["build", "item_group"]),
        build: buildInputSchema.optional().describe("For a build: as the gun-builder tools take it."),
        name: z.string().min(1).max(120).optional(),
        items: z.array(z.string().min(1).max(240)).max(500).optional().describe("For a group: its items (replaces them when updating)."),
        add: z.array(z.string().min(1).max(240)).max(500).optional(),
        remove: z.array(z.string().min(1).max(240)).max(500).optional(),
        id: z.string().max(64).optional().describe("Update this record (needs baseVersion)."),
        baseVersion: z.number().int().min(0).optional(),
        requestId: z.string().max(64).optional().describe("Retrying with the same id returns the first result."),
        gameMode: gameModeSchema,
      },
    },
    async ({ type, build: buildInput, name, items, add, remove, id, baseVersion, requestId, gameMode }, { read }) => {
      const userId = userOf(context);
      if (id !== undefined && baseVersion === undefined) throw new InputError("Updating needs baseVersion: the version list_library or the last save returned.");
      if (type === "build") {
        if (!buildInput) throw new InputError("Give the build.");
        const data = await loadBuildSource(read, gameMode);
        const resolved = await resolveBuild(data, await expandBuildInput(context, buildInput));
        const value: BuildValue = { name: (name ?? resolved.name) || "Saved build", weaponId: resolved.weaponId, root: resolved.root, ...(resolved.ammoId ? { ammoId: resolved.ammoId } : {}) };
        if (id === undefined) {
          const result = await mutate(userId, { mutationId: requestRef(requestId), kind: "build", op: "create", id: newRecordId(), value });
          return { id: result.record.id, version: result.version, url: recordUrl(context.origin, result.record), ...(resolved.warnings.length ? { warnings: resolved.warnings } : {}) };
        }
        const record = await userObject(env(), userId).record("build", id);
        if (!record || record.kind !== "build") throw new InputError("No saved build has that id.");
        const patch = diffBuild(record, { ...record, ...value, ...(value.ammoId ? {} : { ammoId: undefined }) });
        if (!patch) return { id, version: record.version, url: recordUrl(context.origin, record) };
        const result = await mutate(userId, { mutationId: requestRef(requestId), kind: "build", op: "patch", id, baseVersion: baseVersion!, patch });
        return { id, version: result.version, url: recordUrl(context.origin, result.record), ...(result.merged ? { merged: true } : {}), ...(result.restored ? { restored: true } : {}) };
      }
      const matched = await matchItems(read, gameMode, [...(items ?? []), ...(add ?? []), ...(remove ?? [])], context);
      const resolveNames = (list: string[] | undefined) =>
        (list ?? []).flatMap((reference) => {
          const match = matched.itemMatches.find((entry) => entry.input === echo(reference));
          return match?.item ? [match.item] : [];
        });
      const unmatched = matched.itemMatches.filter((entry) => entry.item === null).map((entry) => `No single item matches "${entry.input}"; it was left out.`);
      if (id === undefined) {
        if (!name) throw new InputError("A new item group needs a name.");
        const value = { name, items: [...new Set([...resolveNames(items), ...resolveNames(add)])] };
        const result = await mutate(userId, { mutationId: requestRef(requestId), kind: "item_group", op: "create", id: newRecordId(), value });
        return { id: result.record.id, version: result.version, url: recordUrl(context.origin, result.record), itemMatches: matched.itemMatches, ...(unmatched.length ? { warnings: unmatched } : {}) };
      }
      const record = await userObject(env(), userId).record("item_group", id);
      if (!record || record.kind !== "item_group") throw new InputError("No item group has that id.");
      const patch = items
        ? { ...diffGroup(record, { name: name ?? record.name, items: resolveNames(items) }) }
        : { ...(name && name !== record.name ? { name } : {}), ...(add?.length ? { add: resolveNames(add) } : {}), ...(remove?.length ? { remove: resolveNames(remove) } : {}) };
      if (Object.keys(patch).length === 0) return { id, version: record.version, url: recordUrl(context.origin, record), itemMatches: matched.itemMatches };
      const result = await mutate(userId, { mutationId: requestRef(requestId), kind: "item_group", op: "patch", id, baseVersion: baseVersion!, patch });
      return {
        id,
        version: result.version,
        url: recordUrl(context.origin, result.record),
        itemMatches: matched.itemMatches,
        ...(result.merged ? { merged: true } : {}),
        ...(result.restored ? { restored: true } : {}),
        ...(unmatched.length ? { warnings: unmatched } : {}),
      };
    }
  );

  define(
    "delete_from_library",
    {
      outputSchema: accountResultOutput,
      annotations: { ...write, destructiveHint: true },
      inputSchema: {
        type: z.enum(["build", "item_group", "raid_plan"]),
        id: z.string().max(200),
        baseVersion: z.number().int().min(0).optional().describe("Builds and groups: the version you last saw."),
        requestId: z.string().max(64).optional(),
      },
    },
    async ({ type, id, baseVersion, requestId }) => {
      const userId = userOf(context);
      if (type === "raid_plan") {
        const planId = planIdOf(id);
        const role = await planObject(env(), planId).memberRole(userId);
        if (role === "owner") {
          await destroyPlan(env(), userId, planId);
          return { done: true, message: "The plan was deleted for everyone." };
        }
        await leavePlan(env(), userId, planId);
        return { done: true, message: "You left the plan; it stays for its other members." };
      }
      if (baseVersion === undefined) throw new InputError("Deleting needs baseVersion, so it never removes changes you haven't seen.");
      await mutate(userId, { mutationId: requestRef(requestId), kind: type, op: "delete", id, baseVersion });
      return { done: true, message: "Deleted. An edit from another device within 30 days would restore it." };
    }
  );

  define(
    "share_link",
    {
      outputSchema: accountResultOutput,
      annotations: write,
      inputSchema: {
        type: z.enum(["build", "item_group", "raid_plan"]),
        id: z.string().max(200),
        access: z.enum(["view", "copy", "invite"]).describe("invite is for raid plans; editors can only invite viewers."),
        role: z.enum(["editor", "viewer"]).optional().describe("For invites."),
        expiresInDays: z.number().optional().describe("View/copy: 1, 7 or 30 (default never). Invites: 1/24, 1, 7 (default) or 30."),
        maxUses: z.number().int().min(1).max(50).optional().describe("For invites (default 1)."),
      },
    },
    async ({ type, id, access, role, expiresInDays, maxUses }) => {
      const userId = userOf(context);
      const targetId = type === "raid_plan" ? planIdOf(id) : id;
      const link = await createLink(env(), userId, { target: { type: type === "raid_plan" ? "plan" : type, id: targetId }, access, role, expiresIn: expiresInDays ?? null, maxUses }, new Request(context.origin));
      return { done: true, url: link.url, expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString() : null };
    }
  );

  define(
    "list_links",
    {
      outputSchema: listLinksOutput,
      annotations: readOnly,
      inputSchema: { type: z.enum(["build", "item_group", "raid_plan"]), id: z.string().max(200) },
    },
    async ({ type, id }) => {
      const links = await listLinks(env(), userOf(context), type === "raid_plan" ? "plan" : type, type === "raid_plan" ? planIdOf(id) : id, new Request(context.origin));
      return {
        links: links.map((link) => {
          const row = link as typeof link & { opens?: number; copies?: number; uses?: number; maxUses?: number | null; role?: string | null };
          return {
            url: row.url,
            access: row.access,
            status: row.status,
            ...(row.role ? { role: row.role } : {}),
            ...(row.opens !== undefined ? { opens: row.opens, copies: row.copies } : {}),
            ...(row.uses !== undefined ? { uses: row.uses, maxUses: row.maxUses ?? null } : {}),
            expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
          };
        }),
      };
    }
  );

  define(
    "revoke_link",
    {
      outputSchema: accountResultOutput,
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
      inputSchema: { link: z.string().min(1).max(300) },
    },
    async ({ link }) => {
      const parsed = parseLink(link);
      if (parsed.kind !== "share" && parsed.kind !== "invite" && parsed.kind !== "code") throw new InputError("Give an /s/ link or an invite link.");
      await revokeLink(env(), userOf(context), parsed.code);
      return { done: true, message: "Revoked. People who already joined through an invite stay members." };
    }
  );

  define(
    "open_link",
    {
      outputSchema: openLinkOutput,
      annotations: readOnly,
      inputSchema: { link: z.string().min(1).max(500_000).describe("Any link: /s/, /join#, a plan URL, or a share link."), gameMode: gameModeSchema },
    },
    async ({ link, gameMode }, { read }) => {
      const parsed = parseLink(link);
      if (parsed.kind === "invite" || parsed.kind === "code") {
        const target = await resolveCode(env(), parsed.code);
        if (target?.targetKind === "plan" && parsed.kind === "invite") {
          const preview = await previewInvite(env(), parsed.code);
          return { kind: "invite" as const, can: ["join"], role: preview.role, name: preview.name, map: preview.mapKey, invitedBy: preview.inviter, expiresAt: preview.expiresAt ? new Date(preview.expiresAt).toISOString() : null };
        }
      }
      if (parsed.kind === "share" || parsed.kind === "code") {
        const shared = await openShare(env(), parsed.code, context.userId ?? null);
        const can = shared.access === "copy" ? ["view", "copy"] : ["view"];
        if (shared.targetType === "build") {
          const expanded = await expandBuildInput(context, { shareLink: link });
          return { kind: "build" as const, can, owner: shared.ownerDisplayName, name: (shared.snapshot as BuildValue).name, shareLink: expanded.shareLink, note: "Pass shareLink to evaluate_build for stats and prices." };
        }
        if (shared.targetType === "item_group") {
          const group = shared.snapshot as { name: string; items: string[] };
          return { kind: "item_group" as const, can, owner: shared.ownerDisplayName, name: group.name, items: group.items };
        }
        const plan = shared.snapshot as ReturnType<typeof contentOf>;
        return { kind: "raid_plan" as const, can, owner: shared.ownerDisplayName, name: plan.name, map: plan.mapKey, plan: summarizeContent(plan) };
      }
      if (parsed.kind === "plan") {
        const described = await describeAccountPlan(context, read, gameMode, parsed.planId);
        return { kind: "raid_plan" as const, can: described.role === "viewer" ? ["view"] : ["view", "edit"], role: described.role, name: described.content.name, map: described.content.mapKey, plan: described };
      }
      if (parsed.kind === "legacy-build") {
        const decoded = await parseSharedBuildInput(parsed.link).catch(() => {
          throw new InputError("That build link is damaged.");
        });
        return { kind: "build" as const, can: ["view", "copy"], name: decoded.name, shareLink: parsed.link, note: `A link with the build inside (${decoded.weaponId}); pass it to evaluate_build.` };
      }
      if (parsed.kind !== "legacy-plan") throw new InputError("That invite doesn't exist.");
      const plan = await decodePlanLink(parsed.link);
      return { kind: "raid_plan" as const, can: ["view", "copy"], name: plan.name, map: plan.mapKey, plan: summarizeContent(plan) };
    }
  );

  define(
    "copy_from_link",
    {
      outputSchema: accountResultOutput,
      annotations: write,
      inputSchema: { link: z.string().min(1).max(500_000), name: z.string().min(1).max(120).optional() },
    },
    async ({ link, name }) => {
      const userId = userOf(context);
      const parsed = parseLink(link);
      if (parsed.kind === "share" || parsed.kind === "code") {
        const copied = await copyFromLink(env(), userId, parsed.code, name);
        return { done: true, id: copied.id, url: `${context.origin}${libraryUrl(copied)}` };
      }
      if (parsed.kind === "legacy-build") {
        const decoded = await parseSharedBuildInput(parsed.link);
        const value = { name: name ?? decoded.name ?? "Shared build", weaponId: decoded.weaponId, root: decoded.root, ...(decoded.ammoId ? { ammoId: decoded.ammoId } : {}) };
        const created = await mutate(userId, { mutationId: newOperationId(), kind: "build", op: "create", id: newRecordId(), value });
        return { done: true, id: created.record.id, url: recordUrl(context.origin, created.record) };
      }
      if (parsed.kind === "legacy-plan") {
        const plan = await decodePlanLink(parsed.link);
        const created = await createAccountPlan(env(), userId, { ...plan, name: name ?? plan.name }, { kind: "copy" });
        return { done: true, id: created.planId, url: `${context.origin}/raid-planner/p/${created.planId}` };
      }
      throw new InputError("Copy needs an /s/ copy link or a share link; to join a plan, use join_raid_plan.");
    }
  );

  define(
    "join_raid_plan",
    {
      outputSchema: accountResultOutput,
      annotations: write,
      inputSchema: { invite: z.string().min(1).max(300).describe("The /join#… link or its code.") },
    },
    async ({ invite }) => {
      const parsed = parseLink(invite);
      if (parsed.kind !== "invite" && parsed.kind !== "code") throw new InputError("Give the invite link (/join#…).");
      const joined = await acceptInvite(env(), userOf(context), parsed.code);
      return { done: true, id: joined.planId, role: joined.role, url: `${context.origin}/raid-planner/p/${joined.planId}` };
    }
  );

  define(
    "edit_raid_plan",
    {
      outputSchema: editRaidPlanOutput,
      annotations: write,
      inputSchema: {
        plan: z.string().min(1).max(300).describe("Plan id or /raid-planner/p/ URL."),
        ops: z.array(agentOpSchema).min(1).max(50),
        gameMode: gameModeSchema,
      },
    },
    async ({ plan, ops, gameMode }, { read }) => {
      const userId = userOf(context);
      const planId = planIdOf(plan);
      const snapshot = await memberSnapshot(userId, planId);
      if (snapshot.role === "viewer") throw new DomainError("forbidden", "You can view this plan, but not change it.");
      const config = getMapConfig(snapshot.doc.mapKey) ?? mapConfigs[0];
      const warnings: string[] = [];
      const details = await mapDetailsFor(read, gameMode, snapshot.doc.mapKey, warnings);
      const resolver = createPlaceResolver(config, details, warnings);
      const created: { op: number; id: string }[] = [];
      const planOps = toPlanOps(snapshot.doc, ops, resolver, created, warnings);
      if (resolver.problems.length) throw new InputError(`Nothing was changed. Fix:\n- ${resolver.problems.slice(0, 20).join("\n- ")}`);
      const result = await applyPlanOps(env(), { id: userId, name: "", via: "mcp", ...(context.client ? { client: context.client } : {}) }, planId, newOperationId(), planOps);
      return {
        rev: result.rev,
        url: `${context.origin}/raid-planner/p/${planId}`,
        created,
        ...(resolver.resolvedPlaces.length ? { resolvedPlaces: resolver.resolvedPlaces } : {}),
        ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
      };
    }
  );

  define(
    "manage_raid_plan",
    {
      outputSchema: accountResultOutput,
      annotations: { ...write, destructiveHint: true },
      inputSchema: {
        plan: z.string().min(1).max(300),
        action: z.enum(["rename", "set_allow_copy", "set_role", "remove_member", "transfer", "leave", "delete"]),
        name: z.string().min(1).max(120).optional().describe("For rename."),
        allowCopy: z.boolean().optional(),
        member: z.string().max(64).optional().describe("A member's key or display name, from list_raid_plan_members."),
        role: z.enum(["editor", "viewer"]).optional(),
      },
    },
    async ({ plan, action, name, allowCopy, member, role }) => {
      const userId = userOf(context);
      const planId = planIdOf(plan);
      const memberId = async () => {
        if (!member) throw new InputError("Name the member (their key or display name).");
        const members = (await memberSnapshot(userId, planId)).members ?? [];
        const found = members.filter((entry) => entry.key === member || entry.displayName.toLowerCase() === member.toLowerCase());
        if (found.length !== 1) throw new InputError(found.length ? "Several members have that name: use their key." : "No member has that key or name.");
        const outcome = await planObject(env(), planId).userForKey(userId, found[0].key);
        if (!outcome.ok) throw new DomainError(outcome.error.code, outcome.error.message);
        return outcome.value;
      };
      switch (action) {
        case "rename":
          if (!name) throw new InputError("Give the new name.");
          await applyPlanOps(env(), { id: userId, name: "", via: "mcp", ...(context.client ? { client: context.client } : {}) }, planId, newOperationId(), [{ t: "plan.rename", name }]);
          return { done: true, message: `Renamed to ${name}.` };
        case "set_allow_copy":
          if (allowCopy === undefined) throw new InputError("Give allowCopy.");
          await setPlanAllowCopy(env(), userId, planId, allowCopy);
          return { done: true, message: allowCopy ? "Copies are allowed." : "Copies are off; copy links act as view links." };
        case "set_role":
          if (!role) throw new InputError("Give the role.");
          await setMemberRole(env(), userId, planId, await memberId(), role);
          return { done: true, message: `They are now ${role === "editor" ? "an editor" : "a viewer"}.` };
        case "remove_member":
          await removeMember(env(), userId, planId, await memberId());
          return { done: true, message: "Removed." };
        case "transfer":
          await transferPlan(env(), userId, planId, await memberId());
          return { done: true, message: "Handed over; you stay on as an editor." };
        case "leave": {
          const result = await leavePlan(env(), userId, planId);
          return { done: true, message: result === "left" ? "You left." : result === "transferred" ? "You left; the plan passed to the next member." : "You left, and as no one else was in it, the plan was deleted." };
        }
        case "delete":
          await destroyPlan(env(), userId, planId);
          return { done: true, message: "Deleted for everyone." };
      }
    }
  );

  define(
    "list_raid_plan_members",
    {
      outputSchema: membersOutput,
      annotations: readOnly,
      inputSchema: { plan: z.string().min(1).max(300) },
    },
    async ({ plan }) => {
      const userId = userOf(context);
      const planId = planIdOf(plan);
      const snapshot = await memberSnapshot(userId, planId);
      const { presence: online, anonymous } = await planObject(env(), planId).presenceNow();
      return {
        members: (snapshot.members ?? []).map((member) => ({
          key: member.key,
          name: member.displayName,
          role: member.role,
          you: member.you,
          online: online.some((entry) => entry.key === member.key),
          ...(online.some((entry) => entry.key === member.key && entry.via === "mcp") ? { viaAI: true } : {}),
        })),
        anonymousViewers: anonymous,
      };
    }
  );

  define(
    "report_content",
    {
      outputSchema: accountResultOutput,
      annotations: write,
      inputSchema: {
        link: z.string().max(300).optional(),
        plan: z.string().max(300).optional(),
        reason: z.enum(["offensive", "spam", "personal_info", "other"]),
        detail: z.string().max(500).optional(),
      },
    },
    async ({ link, plan, reason, detail }) => {
      const userId = userOf(context);
      let subject: { link: string } | { plan: string } | { invite: string };
      if (plan) subject = { plan: planIdOf(plan) };
      else if (link) {
        const parsed = parseLink(link);
        if (parsed.kind === "invite") subject = { invite: parsed.code };
        else if (parsed.kind === "share" || parsed.kind === "code") subject = { link: parsed.code };
        else if (parsed.kind === "plan") subject = { plan: parsed.planId };
        else throw new InputError("Links with the content inside can't be reported: nothing is stored.");
      } else throw new InputError("Give the link or the plan.");
      await fileReport(env(), { userId }, { ...subject, reason, detail });
      return { done: true, message: "Thanks, it will be reviewed. The owner isn't told who reported it." };
    }
  );
}

function summarizeContent(plan: { name: string; mapKey: string; route: { position: GamePoint }[]; drawings: unknown[]; notes: { title: string; body: string; position: GamePoint }[]; enabledLayers: string[] }) {
  return {
    route: plan.route.map((waypoint, index) => ({ step: index + 1, x: waypoint.position.x, z: waypoint.position.z })),
    drawings: plan.drawings.length,
    notes: plan.notes.map((note) => ({ title: note.title, body: note.body, x: note.position.x, z: note.position.z })),
    layers: plan.enabledLayers,
  };
}
