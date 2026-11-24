import type { BucketLimit } from "@/app/lib/api/rate-limit-store";

/**
 * Per-user limits, enforced exactly by the user's Durable Object (it runs one request at a time).
 * A transfer of ownership, or an offline edit that restores a deleted item, may take someone past a
 * limit: that is allowed, and only adding more is refused until they are back under it.
 */
export const USER_LIMITS = {
  ownedPlans: 100,
  sharedPlans: 100,
  builds: 200,
  itemGroups: 50,
  plansCreatedPerHour: 20,
  /** A saved build or item group, as JSON. The app's own limits keep real ones far below this. */
  entryBytes: 64 * 1024,
  /** A synced setting's value, as JSON. */
  settingBytes: 16 * 1024,
  /** Active links to one build or item group. */
  linksPerItem: 5,
  /** Mutations per POST /api/library/mutations, and items per import request. */
  batchSize: 50,
  /** Change-feed sockets per user; the oldest is closed past this. */
  deviceSockets: 10,
} as const;

/** Per-user token buckets (§9.2), approved 2026-11-23. Tunable without schema changes. */
export const USER_RATES = {
  libraryWrites: { burst: 120, refillPerSecond: 2 },
  linkCreation: { burst: 20, refillPerSecond: 60 / 3600 },
  acceptsAndCopies: { burst: 20, refillPerSecond: 60 / 3600 },
  imports: { burst: 300, refillPerSecond: 300 / 86_400 },
  reports: { burst: 5, refillPerSecond: 10 / 3600 },
} as const satisfies Record<string, BucketLimit>;

export type UserRate = keyof typeof USER_RATES;

/** Limits on one raid plan (§9.3), approved 2026-11-23. Enforced exactly by the plan's object. */
export const PLAN_LIMITS = {
  maxBytes: 256 * 1024,
  maxRoutePoints: 300,
  maxDrawings: 200,
  maxPointsPerDrawing: 2_000,
  maxDrawingPoints: 5_000,
  maxNotes: 100,
  maxNoteTitleLength: 120,
  maxNoteBodyLength: 1_000,
  maxNameLength: 120,
  maxLayers: 200,
  maxMembers: 50,
  maxActiveLinks: 20,
  maxOpsPerBatch: 50,
  /** Op log kept for reconnect catch-up: whichever is smaller. */
  opLogBatches: 500,
  opLogBytes: 128 * 1024,
  socketsPerMember: 5,
  anonymousSockets: 200,
} as const;

/** Per-socket rates in a plan (§11.4). */
export const PLAN_SOCKET_RATES = {
  batches: { burst: 60, refillPerSecond: 20 },
  previews: { burst: 10, refillPerSecond: 10 },
} as const satisfies Record<string, BucketLimit>;

/** How long tombstones, idempotency records and dead links are kept. */
export const RETENTION_MS = 30 * 24 * 60 * 60_000;
/** A pending plan reservation older than this is released by the alarm. */
export const PENDING_RESERVATION_MS = 10 * 60_000;

export const LIMIT_MESSAGES = {
  ownedPlans: `You can own at most ${USER_LIMITS.ownedPlans} raid plans. Delete or hand over a plan to create another.`,
  sharedPlans: `At most ${USER_LIMITS.sharedPlans} raid plans can be shared with you. Leave one to join another.`,
  builds: `You can save at most ${USER_LIMITS.builds} builds. Delete one to save another.`,
  itemGroups: `You can save at most ${USER_LIMITS.itemGroups} item groups. Delete one to save another.`,
  planRate: `You can create at most ${USER_LIMITS.plansCreatedPerHour} raid plans an hour. Try again later.`,
  planSize: `A raid plan can be at most ${PLAN_LIMITS.maxBytes / 1024} KB. Remove some drawings or notes.`,
  entrySize: `That is larger than ${USER_LIMITS.entryBytes / 1024} KB, the most one saved entry can be.`,
} as const;

/** "…Delete 3 to save another." when someone is over a count, for example after a transfer. */
export function overLimitMessage(message: string, used: number, limit: number) {
  const over = used - limit + 1;
  return over > 1 ? `${message} You are over the limit: remove ${over} first.` : message;
}
