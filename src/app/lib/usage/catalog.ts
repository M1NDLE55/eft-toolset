/**
 * The usage-stats event catalogue: every event the site records, what it may carry, and how it is
 * laid out in Workers Analytics Engine. USAGE_STATS.md describes each event for people.
 *
 * Anonymous by construction: an event is a name plus a few fields from closed lists (game mode,
 * outcome, duration bucket, MCP tool name, route pattern) and at most one game id (a weapon, item or
 * map). There is no field for a user id, IP address, cookie, free text or a raw URL, so none can be
 * recorded. The server adds a daily and a weekly anonymous id (identity.ts): a keyed hash whose key
 * is deleted when the day or week ends, so it can't be traced back to anyone afterwards.
 *
 * Imported by the browser (track.ts) as well as the server, so it imports nothing heavy.
 */

/** Where an event comes from: the website (a beacon), an AI agent over MCP, or the server itself. */
export type UsageSource = "web" | "mcp" | "server";

/** The game objects an event may name, by id: tarkov.dev item ids for weapons and items, map keys for maps. */
export type SubjectKind = "weapon" | "item" | "map";

export interface UsageEventSpec {
  feature: string;
  source: UsageSource;
  /** The kind of game id the event may carry, if any ("any" for MCP tools, which name all three). */
  subject?: SubjectKind | "any";
  /** Whether it may carry the game mode, an outcome and a duration bucket. */
  gameMode?: boolean;
  outcome?: boolean;
  duration?: boolean;
  /** Only mcp.tool_call: the tool's name. */
  tool?: boolean;
  /** Whether it carries the page's route pattern (USAGE_ROUTES), never the URL. */
  route?: boolean;
}

export const USAGE_EVENTS = {
  // AI agents (MCP), recorded by the server for every tool call.
  "mcp.tool_call": { feature: "mcp", source: "mcp", tool: true, subject: "any", gameMode: true, outcome: true, duration: true },

  // Server-side actions.
  "account.sign_in": { feature: "account", source: "server", outcome: true },
  "account.delete": { feature: "account", source: "server", outcome: true },

  // Website actions, sent by the browser as a beacon.
  "page.view": { feature: "site", source: "web", route: true },
  "page.error": { feature: "site", source: "web", route: true },
  "build.create": { feature: "gun-builder", source: "web", subject: "weapon", gameMode: true },
  "build.optimize": { feature: "gun-builder", source: "web", subject: "weapon", gameMode: true, outcome: true, duration: true },
  "build.share": { feature: "gun-builder", source: "web", subject: "weapon" },
  "build.import": { feature: "gun-builder", source: "web", subject: "weapon" },
  "plan.create": { feature: "raid-planner", source: "web", subject: "map" },
  "plan.open": { feature: "raid-planner", source: "web", subject: "map" },
  "plan.share": { feature: "raid-planner", source: "web", subject: "map" },
  "map.view": { feature: "raid-planner", source: "web", subject: "map" },
  "group.create": { feature: "item-groups", source: "web" },
  "group.copy_list": { feature: "item-groups", source: "web", gameMode: true },
  "item.view": { feature: "item-scanner", source: "web", subject: "item", gameMode: true },
  "quest.complete": { feature: "quests", source: "web" },
  "data.export": { feature: "data", source: "web" },
  "data.import": { feature: "data", source: "web", outcome: true },
  "mode.switch": { feature: "game-mode", source: "web", gameMode: true },
  "mcp.setup_copy": { feature: "mcp", source: "web" },
} as const satisfies Record<string, UsageEventSpec>;

export type UsageEventName = keyof typeof USAGE_EVENTS;
export type WebEventName = {
  [Name in UsageEventName]: (typeof USAGE_EVENTS)[Name]["source"] extends "web" ? Name : never;
}[UsageEventName];

export const USAGE_OUTCOMES = ["ok", "error", "cancelled", "input_error", "upstream_error", "timeout", "crash"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

export const GAME_MODES = ["regular", "pve"] as const;

/** Durations are kept only as one of these buckets. */
export const DURATION_BUCKETS = ["<100ms", "100ms-1s", "1-5s", "5-20s", "20s+"] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export function durationBucket(ms: number): DurationBucket {
  if (!(ms >= 100)) return "<100ms";
  if (ms < 1_000) return "100ms-1s";
  if (ms < 5_000) return "1-5s";
  if (ms < 20_000) return "5-20s";
  return "20s+";
}

export interface UsageSubject {
  kind: SubjectKind;
  id: string;
}

/**
 * The site's route patterns, as TanStack Router names them without the index routes' trailing
 * slash. A page view names its pattern ("/item/$itemName"), never the URL, so no item name, plan id
 * or share link reaches the stats. tests/usage-stats.test.ts checks this against routeTree.gen.ts.
 */
export const USAGE_ROUTES = [
  "/", "/admin/stats", "/ammo", "/ammo/$caliber", "/credits", "/data", "/flea-market/pve",
  "/gun-builder", "/gun-builder/$build", "/gun-builder/$build/list", "/gun-builder/best",
  "/gun-builder/best/$weapon", "/gun-builder/compare", "/gun-builder/gunsmith", "/gun-builder/gunsmith/$task",
  "/gun-builder/share/$slug", "/item", "/item/$itemName", "/item-groups", "/item-groups/$group", "/keys",
  "/keys/$map", "/mcp", "/policies/disclaimer-and-use-policy", "/quests", "/quests/$slug", "/raid-planner",
  "/raid-planner/$plan", "/raid-planner/map/$map", "/raid-planner/share/$slug", "/settings",
] as const;
export type UsageRoute = (typeof USAGE_ROUTES)[number] | "other";

/** A router route id as a USAGE_ROUTES pattern, or "other" for one the list doesn't have yet. */
export function usageRoute(routeId: string): UsageRoute {
  const pattern = routeId.length > 1 ? routeId.replace(/\/$/, "") : routeId;
  return (USAGE_ROUTES as readonly string[]).includes(pattern) ? (pattern as UsageRoute) : "other";
}

/** A recorded event: only these fields exist, and each takes a value from a closed list or a checked id. */
export interface UsageEvent {
  name: UsageEventName;
  tool?: string;
  subject?: UsageSubject;
  gameMode?: (typeof GAME_MODES)[number];
  outcome?: UsageOutcome;
  duration?: DurationBucket;
  route?: UsageRoute;
  /** Two-letter country from Cloudflare's request.cf, never from the client. */
  country?: string;
}

export function isUsageEventName(value: unknown): value is UsageEventName {
  return typeof value === "string" && Object.hasOwn(USAGE_EVENTS, value);
}

/** The Analytics Engine dataset the binding writes to (wrangler.jsonc), and the table the SQL API reads. */
export const USAGE_DATASET = "eft_toolset_usage";

/** Bumped if the column layout below ever changes, so old and new rows can be told apart. */
export const USAGE_SCHEMA_VERSION = "1";

/**
 * Analytics Engine columns, by position. index1 is the event name: a low-cardinality sampling key,
 * so rare events are kept even when common ones are sampled. Counts use SUM(_sample_interval).
 */
export const USAGE_COLUMNS = {
  event: "blob1",
  source: "blob2",
  feature: "blob3",
  tool: "blob4",
  subjectKind: "blob5",
  subject: "blob6",
  gameMode: "blob7",
  outcome: "blob8",
  duration: "blob9",
  country: "blob10",
  version: "blob11",
  /** Keyed hashes that change every UTC day and every ISO week; see identity.ts. */
  anonDay: "blob12",
  anonWeek: "blob13",
  /** "1" for a signed-in account, "0" for a visitor, "" when the server can't tell. */
  signedIn: "blob14",
  route: "blob15",
} as const;
