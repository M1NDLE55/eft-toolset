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
  findPlace,
  nearestPlace,
  placesOf,
  resolveColor,
  resolveMap,
  type Place,
} from "@/app/lib/raid-planner/resolve";
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
} from "@/app/lib/raid-planner/limits";
import { PLAN_COLORS, type GamePoint, type RaidPlan } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { createId } from "@/app/lib/id";
import { InputError, round, type ToolContext } from "./context";
import { createRaidPlanOutput, getMapDetailsOutput, listMapsOutput, readRaidPlanOutput } from "./output-schemas";
import { toolDefiner } from "./define-tool";
import { gameModeSchema, offsetSchema } from "./schemas";
import { loadMapDetails } from "./sources";
import { describeMap, SECTIONS, DEFAULT_SECTIONS } from "./map-projection";

const pointSchema = z.union([
  z.object({ x: z.number(), z: z.number() }).describe("Game coordinates in metres."),
  z
    .object({ place: z.string().min(1).max(200) })
    .describe("A named extract, transit, switch, hazard, stationary weapon, key lock (key name), or spawn zone."),
]);
type PointInput = z.infer<typeof pointSchema>;

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
            `Sections to list in full. Default: ${DEFAULT_SECTIONS.join(", ")}. Spawns are otherwise summarised by zone, and locks and loot containers by count.`
          ),
        lootContainerTypes: z
          .array(z.string().max(120))
          .max(20)
          .optional()
          .describe('Only list loot containers whose type name contains one of these, for example "safe" or "jacket".'),
        lootOffset: offsetSchema.describe("Skip this many loot containers; use nextLootOffset."),
        gameMode: gameModeSchema,
      },
    },
    async ({ map, sections, lootContainerTypes, lootOffset, gameMode }, { read }) => {
      return describeMap(context, read, { map, sections, lootContainerTypes, lootOffset, gameMode });
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
        name: z.string().min(1).max(MAX_PLAN_NAME_LENGTH),
        route: z.array(pointSchema).max(MAX_ROUTE_POINTS).default([]).describe("Waypoints in order."),
        drawings: z
          .array(
            z.object({
              kind: z.enum(["pen", "arrow"]),
              color: z.string().max(20).optional().describe(`One of ${Object.keys(COLOR_NAMES).join(", ")}. Default red.`),
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
        gameMode: gameModeSchema.describe("Game mode whose map data resolves named places."),
      },
    },
    async ({ map, name, route, drawings, notes, layers, gameMode }, { read }) => {
      const config = resolveMap(map);
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
      const resolvedPlaces: { input: string; resolved: string }[] = [];
      const toPoint = (entry: PointInput): GamePoint => {
        if ("place" in entry) {
          const place = findPlace(places, entry.place);
          if (!resolvedPlaces.some((item) => item.input === entry.place)) {
            resolvedPlaces.push({ input: entry.place, resolved: `${place.name} (${place.kind})` });
          }
          return { x: round(place.position.x, 1)!, z: round(place.position.z, 1)! };
        }
        return { x: entry.x, z: entry.z };
      };
      const available = details ? new Set(getLayerGroups(details).flatMap((group) => group.options.map((option) => option.id))) : null;
      const enabledLayers =
        layers ?? ["extracts:pmc", "extracts:shared", "transits"].filter((id) => !available || available.has(id));
      const unknownLayers = available ? enabledLayers.filter((id) => !available.has(id)) : [];
      const now = Date.now();
      const plan: RaidPlan = {
        id: createId(),
        name: name.trim(),
        mapKey: config.key,
        createdAt: now,
        updatedAt: now,
        enabledLayers: Array.from(new Set(enabledLayers.filter((id) => !unknownLayers.includes(id)))),
        route: route.map((entry) => ({ id: createId(), position: toPoint(entry) })),
        drawings: drawings.map((drawing) => ({
          id: createId(),
          kind: drawing.kind,
          color: resolveColor(drawing.color, PLAN_COLORS[3]),
          points: drawing.points.map(toPoint),
        })),
        notes: notes.map((note) => ({
          id: createId(),
          position: toPoint(note.at),
          title: note.title,
          body: note.body,
          color: resolveColor(note.color, PLAN_COLORS[0]),
        })),
      };
      const problem = describePlanProblem(plan);
      if (problem) throw new InputError(`The plan ${problem}.`);
      let payload: string;
      try {
        payload = await encodePlanSharePayload(plan);
      } catch (error) {
        throw new InputError(error instanceof Error ? error.message : "The plan could not be shared.");
      }
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
        ...(unknownLayers.length || warnings.length
          ? {
              warnings: [
                ...warnings,
                ...(unknownLayers.length ? [`Left out layer ids this map does not have: ${unknownLayers.join(", ")}.`] : []),
              ],
            }
          : {}),
      };
    }
  );

  define(
    "read_raid_plan",
    {
      outputSchema: readRaidPlanOutput,
      inputSchema: {
        link: z.string().min(1).max(MAX_SHARE_LINK_LENGTH).describe("The share link or its payload."),
        gameMode: gameModeSchema.describe("Game mode whose map data names nearby places."),
      },
    },
    async ({ link, gameMode }, { read }) => {
      const plan = await decodePlanLink(link);
      const config = mapConfigs.find((candidate) => candidate.key === plan.mapKey);
      let places: Place[] = [];
      if (config) {
        try {
          places = placesOf(await loadMapDetails(read, gameMode, config));
        } catch (error) {
          // Without map data the plan is still readable, just without nearby place names.
          if (!(error instanceof TarkovUpstreamError || error instanceof InputError)) throw error;
        }
      }
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
          near: nearestPlace(places, waypoint.position),
        })),
        drawings: plan.drawings.map((drawing) => ({
          kind: drawing.kind,
          color: colorName(drawing.color),
          points: drawing.points.length,
          from: nearestPlace(places, drawing.points[0]),
          to: nearestPlace(places, drawing.points[drawing.points.length - 1]),
        })),
        notes: plan.notes.map((note) => ({
          title: note.title,
          body: note.body,
          x: note.position.x,
          z: note.position.z,
          near: nearestPlace(places, note.position),
        })),
        layers: plan.enabledLayers,
      };
    }
  );
}
