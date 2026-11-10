import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TarkovUpstreamError } from "@/app/lib/api/tarkov-server";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { getFloorStack } from "@/app/lib/raid-planner/floors";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { describePlanProblem } from "@/app/lib/raid-planner/plan-validation";
import { formatDistance, routeLength } from "@/app/lib/raid-planner/route-distance";
import {
  colorName,
  COLOR_NAMES,
  decodePlanLink,
  isInArea,
  matchColor,
  matchPlace,
  nearestPlace,
  PLACE_HELP,
  placesOf,
  planArea,
  resolveMap,
  type Place,
} from "@/app/lib/raid-planner/resolve";
import { floorAt } from "@/app/lib/raid-planner/floors";
import { encodePlanSharePayload, slugifyPlanName } from "@/app/lib/raid-planner/share";
import { MAX_SHARE_LINK_LENGTH } from "@/app/lib/share-codec";
import {
  MAX_DRAWINGS,
  MAX_LAYERS,
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_NOTES,
  MAX_PLAN_NAME_LENGTH,
  MAX_POINTS_PER_DRAWING,
  MAX_ROUTE_POINTS,
  MAX_TOTAL_DRAWING_POINTS,
} from "@/app/lib/raid-planner/limits";
import { PLAN_COLORS, type GamePoint, type RaidPlan } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { createId } from "@/app/lib/id";
import { betweenItems, InputError, round, type ToolContext } from "./context";
import { createRaidPlanOutput, getMapDetailsOutput, listMapsOutput, readRaidPlanOutput } from "./output-schemas";
import { toolDefiner } from "./define-tool";
import { gameModeSchema, offsetSchema } from "./schemas";
import { loadMapDetails } from "./sources";
import { describeMap, SECTIONS, DEFAULT_SECTIONS, MAX_LISTED_ROWS, SPAWN_KINDS } from "./map-projection";

// One object with optional fields, rather than a union, publishes the point once per use. It
// accepts what the union {x, z} | {place} did: coordinates win when both are given, and a
// field of the wrong type is ignored when the other form is complete.
const pointSchema = z
  .object({
    x: z.number().optional().catch(undefined),
    z: z.number().optional().catch(undefined),
    place: z.string().min(1).max(200).optional().catch(undefined),
  })
  .describe("Game coordinates {x, z} in metres, or {place} named as in get_map_details.")
  .transform((point, context): { x: number; z: number } | { place: string } => {
    if (point.x !== undefined && point.z !== undefined) return { x: point.x, z: point.z };
    if (point.place !== undefined) return { place: point.place };
    context.addIssue({ code: "custom", message: 'A point is {"x": ..., "z": ...} in game metres, or {"place": ...}.' });
    return z.NEVER;
  });
type PointInput = z.output<typeof pointSchema>;

type ResolvedPlace = {
  input: string;
  resolved: string;
  match: "exact" | "partial" | "typo";
  approximate?: boolean;
  level: string | null;
  note?: string;
  alsoNamed?: string[];
};

function defaultPlanName(mapName: string, route: PointInput[], resolvedPlaces: ResolvedPlace[]) {
  const nameOf = (entry: PointInput | undefined) => {
    if (!entry || !("place" in entry)) return null;
    const resolved = resolvedPlaces.find((item) => item.input === entry.place)?.resolved;
    return resolved ? resolved.replace(/ \([^)]*\)$/, "") : null;
  };
  const from = nameOf(route[0]);
  const to = route.length > 1 ? nameOf(route[route.length - 1]) : null;
  const name = from && to ? `${mapName}: ${from} to ${to}` : `${mapName} raid plan`;
  return name.slice(0, MAX_PLAN_NAME_LENGTH);
}

/** Problems listed in one error; the rest are counted. */
const MAX_LISTED_PROBLEMS = 20;
/** Place names per call that get typo matching and suggestions when they match nothing exactly. */
const PLACE_TYPO_BUDGET = 20;
/** Points resolved between yields to other requests. */
const POINTS_PER_TURN = 500;

export function registerRaidPlannerTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "list_maps",
    { inputSchema: {}, outputSchema: listMapsOutput, annotations: { openWorldHint: false } },
    async () => ({
      maps: mapConfigs.map((config) => ({
        key: config.key,
        name: config.name,
        levels: getFloorStack(config).map((floor) => floor.name),
        url: `${context.origin}/raid-planner/map/${config.key}`,
      })),
    })
  );

  define(
    "get_map_details",
    {
      outputSchema: getMapDetailsOutput,
      inputSchema: {
        map: z.string().min(1).max(80).describe('Map key or name, for example "customs" or "Streets of Tarkov".'),
        sections: z
          .array(z.enum(SECTIONS))
          .optional()
          .describe(
            `Default: ${DEFAULT_SECTIONS.join(", ")}. spawnZones (spawn points grouped, with counts) come back unless spawns are listed. spawns, locks, and lootContainers share ${MAX_LISTED_ROWS} rows per call; filter or page them.`
          ),
        spawnKinds: z.array(z.enum(SPAWN_KINDS)).max(5).optional().describe("Only list spawn points of these kinds."),
        lockKeys: z
          .array(z.string().max(120))
          .max(20)
          .optional()
          .describe('Only list locks whose key name contains one of these, for example "dorm".'),
        lootContainerTypes: z
          .array(z.string().max(120))
          .max(20)
          .optional()
          .describe('Only list loot containers whose type name contains one of these, for example "safe" or "jacket".'),
        spawnOffset: offsetSchema.describe("Use nextSpawnOffset."),
        lockOffset: offsetSchema.describe("Use nextLockOffset."),
        lootOffset: offsetSchema.describe("Use nextLootOffset."),
        gameMode: gameModeSchema,
      },
    },
    async (query, { read }) => {
      return describeMap(context, read, query);
    }
  );

  define(
    "create_raid_plan",
    {
      // Each call mints new ids and timestamps.
      annotations: { idempotentHint: false },
      outputSchema: createRaidPlanOutput,
      inputSchema: {
        map: z.string().min(1).max(80).describe("Map key or name."),
        name: z.string().max(MAX_PLAN_NAME_LENGTH).optional().describe("Default: the first and last named places."),
        route: z.array(pointSchema).max(MAX_ROUTE_POINTS).default([]).describe("Waypoints in order."),
        drawings: z
          .array(
            z.object({
              kind: z.enum(["pen", "arrow"]),
              color: z.string().max(20).optional().describe(`${Object.keys(COLOR_NAMES).join(", ")}. Default red.`),
              points: z.array(pointSchema).min(2).max(MAX_POINTS_PER_DRAWING),
            })
          )
          .max(MAX_DRAWINGS)
          .default([]),
        notes: z
          .array(
            z.object({
              at: pointSchema,
              title: z.string().max(MAX_NOTE_TITLE_LENGTH),
              body: z.string().max(MAX_NOTE_BODY_LENGTH).default(""),
              color: z.string().max(20).optional().describe("Default tan."),
            })
          )
          .max(MAX_NOTES)
          .default([]),
        layers: z
          .array(z.string().max(120))
          .max(MAX_LAYERS)
          .optional()
          .describe('Layer ids from get_map_details, such as "extracts:pmc" or "spawns:boss". Default: PMC and shared extracts and transits.'),
        gameMode: gameModeSchema,
      },
    },
    async ({ map, name, route, drawings, notes, layers, gameMode }, { read }) => {
      const config = resolveMap(map);
      // Checked before any names are resolved, so an oversized plan costs nothing to refuse.
      const drawingPoints = drawings.reduce((total, drawing) => total + drawing.points.length, 0);
      if (drawingPoints > MAX_TOTAL_DRAWING_POINTS) {
        throw new InputError(
          `The plan has ${drawingPoints} drawing points; the limit is ${MAX_TOTAL_DRAWING_POINTS}. Simplify the drawings.`
        );
      }
      const needsPlaces = [...route, ...drawings.flatMap((d) => d.points), ...notes.map((n) => n.at)].some(
        (entry) => "place" in entry
      );
      const warnings: string[] = [];
      let details: MapDetails | null = null;
      try {
        details = await loadMapDetails(read, gameMode, config);
      } catch (error) {
        // Coordinates alone still make a plan; only the layer check is skipped.
        if (needsPlaces || !(error instanceof TarkovUpstreamError || error instanceof InputError)) throw error;
        warnings.push("Map data is unavailable, so layer ids were not checked.");
      }
      const places = details ? placesOf(details) : [];
      const area = planArea(config, details);
      // Every problem is collected, so one reply can fix them all.
      const problems: string[] = [];
      let placeProblem = false;
      const resolvedPlaces: ResolvedPlace[] = [];
      const resolved = new Map<string, GamePoint | null>();
      let typoBudget = PLACE_TYPO_BUDGET;
      let typosSkipped = false;
      const toPoint = (entry: PointInput, where: string): GamePoint => {
        if (!("place" in entry)) {
          if (!isInArea(area, entry)) {
            problems.push(
              `${where}: x ${entry.x}, z ${entry.z} is outside ${config.name} (x ${area.minX} to ${area.maxX}, z ${area.minZ} to ${area.maxZ}).`
            );
          }
          return { x: entry.x, z: entry.z };
        }
        const known = resolved.get(entry.place);
        if (known !== undefined) return known ?? { x: 0, z: 0 };
        const result = matchPlace(places, entry.place, { typos: typoBudget > 0 });
        if ("error" in result || result.match === "typo") typoBudget -= 1;
        if ("error" in result) {
          if (typoBudget < 0) typosSkipped = true;
          problems.push(`${where}: ${result.error}`);
          placeProblem = true;
          resolved.set(entry.place, null);
          return { x: 0, z: 0 };
        }
        const { place } = result;
        const approximate = result.match !== "exact" || Boolean(place.derived);
        resolvedPlaces.push({
          input: entry.place,
          resolved: `${place.name} (${place.kind})`,
          match: result.match,
          ...(approximate ? { approximate } : {}),
          level: typeof place.position.y === "number" ? floorAt(config, place.position).name : null,
          ...(place.derived ? { note: `Approximate position: ${place.derived}.` } : {}),
          ...(result.others.length
            ? { alsoNamed: result.others.slice(0, 3).map((other) => `${other.name} (${other.kind})`) }
            : {}),
        });
        if (approximate) {
          warnings.push(
            `"${entry.place}" was placed at ${place.name} (${place.kind})${
              place.derived ? `, the ${place.derived}` : `, a ${result.match} match`
            }. Describe it by that name, or give coordinates.`
          );
        }
        const point = { x: round(place.position.x, 1)!, z: round(place.position.z, 1)! };
        resolved.set(entry.place, point);
        return point;
      };
      const colorOf = (value: string | undefined, fallback: (typeof PLAN_COLORS)[number]) => {
        const { color, warning } = matchColor(value, fallback);
        if (warning && !warnings.includes(warning)) warnings.push(warning);
        return color;
      };
      const available = details ? new Set(getLayerGroups(details).flatMap((group) => group.options.map((option) => option.id))) : null;
      const enabledLayers =
        layers ?? ["extracts:pmc", "extracts:shared", "transits"].filter((id) => !available || available.has(id));
      const unknownLayers = available ? enabledLayers.filter((id) => !available.has(id)) : [];
      const now = Date.now();
      // Resolving thousands of points is synchronous work, so other requests get turns between batches.
      let pointsResolved = 0;
      const resolvePoint = async (entry: PointInput, where: string) => {
        if (++pointsResolved % POINTS_PER_TURN === 0) await betweenItems(context.signal);
        return toPoint(entry, where);
      };
      const planRoute = [];
      for (const [index, entry] of route.entries()) {
        planRoute.push({ id: createId(), position: await resolvePoint(entry, `route[${index}]`) });
      }
      const planDrawings = [];
      for (const [index, drawing] of drawings.entries()) {
        const points: GamePoint[] = [];
        for (const [pointIndex, point] of drawing.points.entries()) {
          points.push(await resolvePoint(point, `drawings[${index}].points[${pointIndex}]`));
        }
        planDrawings.push({ id: createId(), kind: drawing.kind, color: colorOf(drawing.color, PLAN_COLORS[3]), points });
      }
      const planNotes = [];
      for (const [index, note] of notes.entries()) {
        planNotes.push({
          id: createId(),
          position: await resolvePoint(note.at, `notes[${index}].at`),
          title: note.title,
          body: note.body,
          color: colorOf(note.color, PLAN_COLORS[0]),
        });
      }
      if (problems.length > 0) {
        const listed = problems.slice(0, MAX_LISTED_PROBLEMS);
        const more = problems.length - listed.length;
        throw new InputError(
          `The plan was not created. Fix ${problems.length === 1 ? "this" : `these ${problems.length} problems`}:\n- ${listed.join("\n- ")}${
            more > 0 ? `\n- and ${more} more.` : ""
          }${typosSkipped ? `\nClose spellings are only suggested for the first ${PLACE_TYPO_BUDGET} unknown names.` : ""}${
            placeProblem ? `\n${PLACE_HELP}` : ""
          }`
        );
      }
      const plan: RaidPlan = {
        id: createId(),
        name: name?.trim() || defaultPlanName(config.name, route, resolvedPlaces),
        mapKey: config.key,
        createdAt: now,
        updatedAt: now,
        enabledLayers: Array.from(new Set(enabledLayers.filter((id) => !unknownLayers.includes(id)))),
        route: planRoute,
        drawings: planDrawings,
        notes: planNotes,
      };
      const problem = describePlanProblem(plan);
      if (problem) throw new InputError(`The plan ${problem}.`);
      let payload: string;
      try {
        payload = await encodePlanSharePayload(plan);
      } catch (error) {
        throw new InputError(error instanceof Error ? error.message : "The plan could not be shared.");
      }
      if (unknownLayers.length) warnings.push(`Left out layer ids this map does not have: ${unknownLayers.join(", ")}.`);
      const distance = routeLength(plan.route);
      return {
        shareLink: `${context.origin}/raid-planner/share/${slugifyPlanName(plan.name)}#p=${payload}`,
        map: config.name,
        name: plan.name,
        waypoints: plan.route.length,
        routeDistanceMeters: Math.round(distance),
        routeDistance: formatDistance(distance),
        drawings: plan.drawings.length,
        notes: plan.notes.length,
        layers: plan.enabledLayers,
        ...(resolvedPlaces.length ? { resolvedPlaces } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    }
  );

  define(
    "read_raid_plan",
    {
      outputSchema: readRaidPlanOutput,
      inputSchema: {
        link: z.string().min(1).max(MAX_SHARE_LINK_LENGTH).describe("The share link or its payload."),
        gameMode: gameModeSchema,
      },
    },
    async ({ link, gameMode }, { read }) => {
      const plan = await decodePlanLink(link);
      const config = mapConfigs.find((candidate) => candidate.key === plan.mapKey);
      let details: MapDetails | null = null;
      if (config) {
        try {
          details = await loadMapDetails(read, gameMode, config);
        } catch (error) {
          // Without map data the plan is still readable, just without nearby place names.
          if (!(error instanceof TarkovUpstreamError || error instanceof InputError)) throw error;
        }
      }
      const places: Place[] = details ? placesOf(details) : [];
      const near = (point: GamePoint) => nearestPlace(places, point, config);
      const area = config ? planArea(config, details) : null;
      const points = [
        ...plan.route.map((waypoint) => waypoint.position),
        ...plan.drawings.flatMap((drawing) => drawing.points),
        ...plan.notes.map((note) => note.position),
      ];
      const offMap = area ? points.filter((point) => !isInArea(area, point)).length : 0;
      const warnings = [
        ...(config ? [] : [`This app has no map "${plan.mapKey}".`]),
        ...(offMap ? [`${offMap} point${offMap === 1 ? " is" : "s are"} outside the map.`] : []),
      ];
      const distance = routeLength(plan.route);
      return {
        name: plan.name,
        map: config ? { key: config.key, name: config.name } : { key: plan.mapKey, name: "Unknown map" },
        routeDistanceMeters: Math.round(distance),
        routeDistance: formatDistance(distance),
        route: plan.route.map((waypoint, index) => ({
          step: index + 1,
          x: waypoint.position.x,
          z: waypoint.position.z,
          near: near(waypoint.position),
        })),
        drawings: plan.drawings.map((drawing) => ({
          kind: drawing.kind,
          color: colorName(drawing.color),
          points: drawing.points.length,
          from: near(drawing.points[0]),
          to: near(drawing.points[drawing.points.length - 1]),
        })),
        notes: plan.notes.map((note) => ({
          title: note.title,
          body: note.body,
          x: note.position.x,
          z: note.position.z,
          near: near(note.position),
        })),
        layers: plan.enabledLayers,
        ...(warnings.length ? { warnings } : {}),
      };
    }
  );
}
