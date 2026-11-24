import type { PlanDoc, PlanOp } from "@/app/lib/sharing/plan-doc";
import type { Role } from "@/app/lib/sharing/types";
import type { PublicMember } from "./plan-store";

/**
 * The live protocol (§11.3): JSON text frames on /api/plans/<id>/live (members) and
 * /api/s/<code>/live (view links). The literal text "ping" is answered "pong" by the runtime without
 * waking the object.
 */
export const MAX_SOCKET_MESSAGE = 512 * 1024;

export type ClientMessage =
  | { type: "ops"; opId: string; ops: PlanOp[] }
  | { type: "preview"; ops: PlanOp[] }
  | { type: "presence"; editing: string | null; floor: string | null };

export type RejectCode = "forbidden" | "gone" | "conflict" | "limit" | "invalid" | "rate_limited";

export interface Actor {
  id: string | null;
  name: string;
  via: "web" | "mcp";
  client?: string;
}

export interface Presence {
  key: string;
  name: string;
  role: Role;
  via: "web" | "mcp";
  client?: string;
  /** The item being edited: "note:<id>", "wp:<id>"… */
  editing: string | null;
  floor: string | null;
}

export type ServerMessage =
  | {
      type: "snapshot";
      rev: number;
      doc: PlanDoc;
      you: { role: Role | "anonymous"; key: string | null };
      settings: { allowCopy: boolean; name: string };
      createdAt: number;
      updatedAt: number;
      members?: PublicMember[];
      presence: Presence[];
      anonymous: number;
      online?: number;
    }
  | { type: "ops"; rev: number; opId: string; actor: Actor; ops: PlanOp[] }
  | { type: "caught-up"; rev: number }
  | { type: "ack"; opId: string; rev: number }
  | { type: "reject"; opId: string; code: RejectCode; message: string; details?: unknown }
  | { type: "preview"; actor: Actor; ops: PlanOp[] }
  | { type: "presence"; presence: Presence[]; anonymous: number; online?: number }
  | { type: "members"; members: PublicMember[] }
  | { type: "settings"; allowCopy: boolean; name: string }
  | { type: "notice"; kind: "ownership" | "role"; message: string }
  /** Sent just before the server closes the socket, with the close code (§11.3). */
  | { type: "closing"; code: number; reason: string };

/** Close codes (§11.3). */
export const CLOSE = {
  unauthenticated: 4001,
  removed: 4003,
  deleted: 4004,
  rateLimited: 4008,
  roleChanged: 4009,
  linkClosed: 4010,
} as const;

/** What each socket carries across hibernation (well under the 16 KB attachment limit). */
export interface SocketInfo {
  connId: string;
  userId: string | null;
  key: string | null;
  role: Role | "anonymous";
  link: string | null;
  name: string;
  editing: string | null;
  floor: string | null;
  connectedAt: number;
  batches: { tokens: number; at: number };
  previews: { tokens: number; at: number };
  strikes: number;
}
