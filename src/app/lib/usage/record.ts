import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { MCP_TOOL_NAMES } from "@/app/lib/mcp/catalog";
import { platform } from "@/app/lib/server/platform";
import { clientIp } from "@/app/lib/api/rate-limit";
import { anonymousIds, NO_IDS, type AnonymousIds, type UsageIdentity } from "./identity";
import {
  DURATION_BUCKETS,
  GAME_MODES,
  USAGE_EVENTS,
  USAGE_OUTCOMES,
  USAGE_ROUTES,
  USAGE_SCHEMA_VERSION,
  type SubjectKind,
  type UsageEvent,
  type UsageEventSpec,
} from "./catalog";

/** One Analytics Engine row: the event name as the index and the blobs in USAGE_COLUMNS order. No doubles. */
export interface UsageDataPoint {
  indexes: [string];
  blobs: string[];
}

const TARKOV_ID = /^[0-9a-f]{24}$/;
const MAP_KEYS = new Set(mapConfigs.map((config) => config.key));
const TOOL_NAMES = new Set<string>(MCP_TOOL_NAMES);
/** ISO 3166 alpha-2, plus Cloudflare's T1 for Tor; XX (unknown) and anything else is left out. */
const COUNTRY = /^(?:[A-Z]{2}|T1)$/;

export function isValidSubject(kind: SubjectKind, id: string) {
  return kind === "map" ? MAP_KEYS.has(id) : TARKOV_ID.test(id);
}

/**
 * The event as it will be written, or null when anything about it is outside the catalogue: an
 * unknown event, a field the event doesn't take, a value outside its closed list, or an id that
 * isn't a tarkov.dev id or map key. Nothing is passed through unchecked.
 */
export function checkedEvent(event: UsageEvent): UsageEvent | null {
  const spec: UsageEventSpec | undefined = Object.hasOwn(USAGE_EVENTS, event.name) ? USAGE_EVENTS[event.name] : undefined;
  if (!spec) return null;
  const allowed = new Set(["name", "country"]);
  if (spec.tool) allowed.add("tool");
  if (spec.subject) allowed.add("subject");
  if (spec.gameMode) allowed.add("gameMode");
  if (spec.outcome) allowed.add("outcome");
  if (spec.duration) allowed.add("duration");
  if (spec.route) allowed.add("route");
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined && !allowed.has(key)) return null;
  }
  if (event.tool !== undefined && !TOOL_NAMES.has(event.tool)) return null;
  if (event.subject !== undefined) {
    const { kind, id } = event.subject;
    if (Object.keys(event.subject).length !== 2) return null;
    if (spec.subject !== "any" && spec.subject !== kind) return null;
    if (!isValidSubject(kind, id)) return null;
  }
  if (event.gameMode !== undefined && !GAME_MODES.includes(event.gameMode)) return null;
  if (event.outcome !== undefined && !USAGE_OUTCOMES.includes(event.outcome)) return null;
  if (event.duration !== undefined && !DURATION_BUCKETS.includes(event.duration)) return null;
  if (event.route !== undefined && event.route !== "other" && !(USAGE_ROUTES as readonly string[]).includes(event.route)) return null;
  // An unrecognised country is dropped rather than refusing the event: it comes from Cloudflare.
  const country = event.country !== undefined && event.country !== "XX" && COUNTRY.test(event.country) ? event.country : undefined;
  return { ...event, country };
}

/**
 * The Analytics Engine row for a checked event, built field by field from the catalogue's columns.
 * The only identity in it is the anonymous ids, already hashed.
 */
export function usageDataPoint(event: UsageEvent, ids: AnonymousIds = NO_IDS): UsageDataPoint {
  const spec = USAGE_EVENTS[event.name];
  return {
    indexes: [event.name],
    blobs: [
      event.name,
      spec.source,
      spec.feature,
      event.tool ?? "",
      event.subject?.kind ?? "",
      event.subject?.id ?? "",
      event.gameMode ?? "",
      event.outcome ?? "",
      event.duration ?? "",
      event.country ?? "",
      USAGE_SCHEMA_VERSION,
      ids.day,
      ids.week,
      ids.signedIn,
      event.route ?? "",
    ],
  };
}

/** The visitor's country as Cloudflare resolved it (request.cf.country), or undefined. */
export function requestCountry(request: Request | undefined): string | undefined {
  const country = (request as { cf?: { country?: unknown } } | undefined)?.cf?.country;
  return typeof country === "string" ? country : undefined;
}

/** Who made a request, for the anonymous ids only: the trusted client IP and the user agent. */
export function requestIdentity(request: Request, ip: string | null, userId?: string): UsageIdentity {
  return { userId, ip, userAgent: request.headers.get("user-agent") };
}

/** recordUsage for an event a request caused: its country and anonymous ids come from the request. */
export function recordRequestUsage(request: Request, event: UsageEvent, userId?: string) {
  recordUsage({ ...event, country: requestCountry(request) }, requestIdentity(request, clientIp(request), userId));
}

/**
 * Records one event in the background. Never throws and never delays the response: a stats failure
 * must not affect the request. Events outside the catalogue are dropped.
 */
export function recordUsage(event: UsageEvent, identity?: UsageIdentity) {
  platform().waitUntil(writeUsageEvent(event, identity));
}

/** recordUsage's work, awaitable: true when the row was handed to Analytics Engine. */
export async function writeUsageEvent(event: UsageEvent, identity?: UsageIdentity): Promise<boolean> {
  const checked = checkedEvent(event);
  if (!checked) return false;
  const write = platform().writeUsage;
  if (!write) return false;
  // Without the keys the event is still counted, just not towards unique visitors.
  const ids = await anonymousIds(identity).catch((error: unknown) => {
    console.error("Usage ids could not be made", error instanceof Error ? error.message : "unknown error");
    return NO_IDS;
  });
  try {
    write(usageDataPoint(checked, ids));
    return true;
  } catch (error) {
    console.error("Usage event could not be written", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}
