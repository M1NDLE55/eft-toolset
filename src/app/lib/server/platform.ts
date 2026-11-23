/**
 * What the server code needs from where it runs. The Worker entry (src/server.ts) installs the
 * Cloudflare implementation at startup: static assets for the bundled snapshots, KV for data shared
 * between isolates, and waitUntil for work that outlives a response. Anywhere else (tests, Node
 * scripts) the defaults read data/ from disk and share nothing.
 */
export interface Platform {
  /** A file of the bundled data snapshot (data/<path> in the repo), or null when it isn't there. */
  readDataFile(path: string): Promise<Uint8Array | null>;
  /** Key-value storage shared by every isolate, or null when there is none. */
  sharedStore: SharedStore | null;
  /** Keeps background work alive after the response; runs it unobserved where there is no runtime to ask. */
  waitUntil(promise: Promise<unknown>): void;
  /** Charges a signed-in user's MCP budget where every isolate sees it (their UserDO); absent elsewhere. */
  chargeUserBudget?: (userId: string, limit: BucketLimit, cost: number, refundOnDenial: number) => Promise<RequestBudget>;
  /**
   * Counts a request against a client IP's limit shared by every isolate (the Workers rate-limit
   * binding); true when it is within the limit. Absent elsewhere, where only in-memory limits apply.
   */
  limitClientIp?: (pool: "mcp" | "web", ip: string) => Promise<boolean>;
  /** The request header that carries the client's real IP, set by the platform itself (never forgeable). */
  trustedClientIpHeader?: string;
  /** Converts an image, scaled to fit the box and never enlarged (Cloudflare Images in the Worker). */
  convertImage?: (bytes: Uint8Array, options: { width: number; height: number; format: "image/png" }) => Promise<Uint8Array | null>;
}

/** A token bucket's size and refill rate. */
export interface BucketLimit {
  burst: number;
  refillPerSecond: number;
}

export interface RequestBudget {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface SharedStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

async function readFromDisk(path: string): Promise<Uint8Array | null> {
  const [{ readFile }, { join }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  try {
    return new Uint8Array(await readFile(join(process.cwd(), "data", path)));
  } catch {
    return null;
  }
}

const nodePlatform: Platform = {
  readDataFile: readFromDisk,
  sharedStore: null,
  waitUntil(promise) {
    void promise.catch(() => undefined);
  },
};

let current: Platform = nodePlatform;

export function platform(): Platform {
  return current;
}

/** Installs the runtime's implementation; with no argument, restores the Node defaults (tests). */
export function setPlatform(next?: Partial<Platform>) {
  current = next ? { ...nodePlatform, ...next } : nodePlatform;
}

/** Reads a data file as UTF-8 text, or null. */
export async function readDataText(path: string): Promise<string | null> {
  const bytes = await platform().readDataFile(path);
  return bytes ? new TextDecoder().decode(bytes) : null;
}
