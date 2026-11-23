import {
  MAX_DRAWINGS,
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_NOTES,
  MAX_ROUTE_POINTS,
  MAX_TOTAL_DRAWING_POINTS,
} from "@/app/lib/raid-planner/limits";

/**
 * Per-user limits, enforced exactly by the user's Durable Object (it runs one request at a time).
 * A transfer of ownership may take someone past a limit: it is allowed, and only creating more is
 * blocked until they are back under it.
 */
export const USER_LIMITS = {
  ownedPlans: 100,
  sharedPlans: 100,
  builds: 200,
  itemGroups: 50,
  plansCreatedPerHour: 20,
  /** A saved build or item group, as JSON. The app's own limits keep real ones far below this. */
  entryBytes: 64 * 1024,
} as const;

/**
 * Limits on one raid plan. The structural caps are the raid planner's own (route points, notes,
 * drawings), so any plan the app can save fits; the size cap bounds the whole stored plan.
 */
export const PLAN_LIMITS = {
  maxBytes: 256 * 1024,
  maxRoutePoints: MAX_ROUTE_POINTS,
  maxNotes: MAX_NOTES,
  maxNoteTitleLength: MAX_NOTE_TITLE_LENGTH,
  maxNoteBodyLength: MAX_NOTE_BODY_LENGTH,
  maxDrawings: MAX_DRAWINGS,
  maxDrawingPoints: MAX_TOTAL_DRAWING_POINTS,
  maxMembers: 50,
} as const;

export const LIMIT_MESSAGES = {
  ownedPlans: `You can own at most ${USER_LIMITS.ownedPlans} raid plans. Delete or hand over a plan to create another.`,
  sharedPlans: `At most ${USER_LIMITS.sharedPlans} raid plans can be shared with you. Leave one to join another.`,
  builds: `You can save at most ${USER_LIMITS.builds} builds. Delete one to save another.`,
  itemGroups: `You can save at most ${USER_LIMITS.itemGroups} item groups. Delete one to save another.`,
  planRate: `You can create at most ${USER_LIMITS.plansCreatedPerHour} raid plans an hour. Try again later.`,
  planSize: `A raid plan can be at most ${PLAN_LIMITS.maxBytes / 1024} KB. Remove some drawings or notes.`,
  entrySize: `That is larger than ${USER_LIMITS.entryBytes / 1024} KB, the most one saved entry can be.`,
} as const;
