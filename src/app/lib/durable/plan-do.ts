import { DurableObject } from "cloudflare:workers";
import { outcome, type Outcome } from "./outcome";
import { PlanStore, type PlanMember, type StoredPlan } from "./plan-store";
import type { Sql } from "./sql";
import type { PlanRole } from "./user-store";

/** Who a live connection belongs to; kept with the socket so it survives hibernation. */
interface SocketAttachment {
  userId: string;
  role: PlanRole;
}

/** The header the Worker sets on a live-connection request after checking the user's token. */
export const PLAN_SOCKET_USER_HEADER = "X-EFT-User-Id";

/**
 * One per raid plan, named by the plan's id (see access.ts): the plan's content, its members and
 * their roles, in SQLite. Live editing connects through hibernatable WebSockets; the socket
 * handling is in place, but no messages are acted on yet.
 */
export class PlanDO extends DurableObject<Env> {
  private readonly store: PlanStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new PlanStore(ctx.storage.sql as unknown as Sql, (work) => ctx.storage.transactionSync(work));
    void ctx.blockConcurrencyWhile(async () => {
      this.store.migrate();
    });
  }

  create(planId: string, ownerId: string, content: unknown): Outcome<StoredPlan> {
    return outcome(() => this.store.create(planId, ownerId, content));
  }

  read(userId: string): Outcome<StoredPlan> {
    return outcome(() => this.store.read(userId));
  }

  update(userId: string, content: unknown, expectedVersion?: number): Outcome<StoredPlan> {
    return outcome(() => this.store.update(userId, content, expectedVersion));
  }

  members(userId: string): Outcome<PlanMember[]> {
    return outcome(() => this.store.members(userId));
  }

  share(ownerId: string, userId: string, role: Exclude<PlanRole, "owner">): Outcome<null> {
    return outcome(() => {
      this.store.share(ownerId, userId, role);
      return null;
    });
  }

  unshare(actorId: string, userId: string): Outcome<null> {
    return outcome(() => {
      this.store.unshare(actorId, userId);
      return null;
    });
  }

  transfer(ownerId: string, toUserId: string): Outcome<null> {
    return outcome(() => {
      this.store.transfer(ownerId, toUserId);
      return null;
    });
  }

  delete(ownerId: string): Outcome<string[]> {
    const result = outcome(() => this.store.delete(ownerId));
    if (result.ok) for (const socket of this.ctx.getWebSockets()) socket.close(1000, "The plan was deleted.");
    return result;
  }

  /**
   * Live connections. The Worker checks the user's token and passes their id in a header; only
   * members connect. The socket is accepted with the hibernation API, so an idle plan costs nothing.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    const userId = request.headers.get(PLAN_SOCKET_USER_HEADER);
    const role = userId ? this.store.exists() && this.store.role(userId) : null;
    if (!userId || !role) return new Response("That plan isn't shared with you.", { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, role } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket) {
    socket.send(JSON.stringify({ type: "error", message: "Live editing isn't available yet." }));
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }
}
