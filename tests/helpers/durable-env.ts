import { sqlite } from "./sqlite";
import { UserDO } from "@/app/lib/durable/user-do";
import { PlanDO } from "@/app/lib/durable/plan-do";
import { LinkDO } from "@/app/lib/durable/link-do";
import { ModerationDO } from "@/app/lib/durable/moderation-do";
import type { DurableBindings } from "@/app/lib/durable/access";

/**
 * The Worker's Durable Object namespaces, in memory: one real object per name, each with its own
 * SQLite database, alarms that run when the test calls `runAlarms`, and sockets that record what
 * they were sent. RPC is a direct call with the result cloned, as RPC would.
 */
export class FakeSocket {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  attachment: unknown = null;
  tags: string[] = [];
  readyState = 1;
  send(message: string) {
    if (this.closed) throw new Error("closed");
    this.sent.push(message);
  }
  close(code = 1000, reason = "") {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  messages<T = Record<string, unknown>>(): T[] {
    return this.sent.filter((text) => text !== "pong").map((text) => JSON.parse(text) as T);
  }
  last<T = Record<string, unknown>>(type?: string): T | undefined {
    const all = this.messages<T & { type?: string }>();
    return (type ? all.filter((message) => message.type === type) : all).at(-1);
  }
}

const globals = globalThis as Record<string, unknown>;
globals.WebSocketRequestResponsePair ??= class {
  constructor(
    readonly request: string,
    readonly response: string
  ) {}
};

/** The server ends of sockets made by the latest WebSocketPair, so tests can find them. */
export const acceptedSockets: FakeSocket[] = [];
globals.WebSocketPair = class {
  0: FakeSocket;
  1: FakeSocket;
  constructor() {
    this[0] = new FakeSocket();
    this[1] = new FakeSocket();
    acceptedSockets.push(this[1]);
  }
};

// Node's Response refuses status 101; a Worker returns it for WebSocket upgrades.
const NodeResponse = globalThis.Response;
class UpgradeResponse extends NodeResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    if (init?.status === 101) {
      super(null, { status: 200 });
      Object.defineProperty(this, "status", { value: 101 });
      Object.defineProperty(this, "webSocket", { value: init.webSocket });
    } else {
      super(body, init);
    }
  }
}
globals.Response = UpgradeResponse;

class FakeState {
  readonly storage;
  readonly sockets: FakeSocket[] = [];
  alarm: number | null = null;
  constructor(
    readonly id: { name: string },
    readonly db = sqlite()
  ) {
    const state = this;
    this.storage = {
      sql: this.db.sql,
      transactionSync<T>(work: () => T): T {
        let result: T;
        state.db.transaction(() => {
          result = work();
        });
        return result!;
      },
      async getAlarm() {
        return state.alarm;
      },
      async setAlarm(at: number) {
        state.alarm = at;
      },
      async deleteAlarm() {
        state.alarm = null;
      },
      async deleteAll() {
        const tables = state.db.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").toArray();
        for (const { name } of tables) state.db.sql.exec(`DROP TABLE IF EXISTS "${name}"`);
        state.alarm = null;
      },
    };
  }
  blockConcurrencyWhile(work: () => Promise<void>) {
    return work();
  }
  setWebSocketAutoResponse() {}
  acceptWebSocket(socket: FakeSocket, tags: string[] = []) {
    socket.tags = tags;
    this.sockets.push(socket);
  }
  getWebSockets(tag?: string) {
    return this.sockets.filter((socket) => !socket.closed && (!tag || socket.tags.includes(tag)));
  }
  getTags(socket: FakeSocket) {
    return socket.tags;
  }
}

type Ctor<T> = new (ctx: DurableObjectState, env: never) => T;

class Namespace<T extends object> {
  readonly objects = new Map<string, { object: T; state: FakeState }>();
  constructor(
    private readonly ctor: Ctor<T>,
    private readonly env: () => unknown
  ) {}
  getByName(name: string): T {
    let entry = this.objects.get(name);
    if (!entry) {
      const state = new FakeState({ name });
      const object = new this.ctor(state as unknown as DurableObjectState, this.env() as never);
      entry = { object, state };
      this.objects.set(name, entry);
    }
    const target = entry.object;
    // Results cross a structured clone, as over RPC.
    return new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object);
        if (typeof value !== "function" || property === "fetch") return typeof value === "function" ? value.bind(object) : value;
        return async (...args: unknown[]) => structuredClone(await value.apply(object, structuredClone(args)));
      },
    });
  }
  state(name: string) {
    return this.objects.get(name)?.state;
  }
  raw(name: string) {
    this.getByName(name);
    return this.objects.get(name)!.object;
  }
}

export function durableEnv() {
  const env: Record<string, unknown> = {};
  const get = () => env;
  const USER = new Namespace(UserDO as unknown as Ctor<UserDO>, get);
  const PLAN = new Namespace(PlanDO as unknown as Ctor<PlanDO>, get);
  const LINK = new Namespace(LinkDO as unknown as Ctor<LinkDO>, get);
  const MODERATION = new Namespace(ModerationDO as unknown as Ctor<ModerationDO>, get);
  Object.assign(env, { USER, PLAN, LINK, MODERATION });
  return {
    env: env as unknown as DurableBindings,
    USER,
    PLAN,
    LINK,
    MODERATION,
    /** Runs every due alarm until none are left (or a round limit). */
    async runAlarms(now = Date.now()) {
      for (let round = 0; round < 10; round += 1) {
        let ran = false;
        for (const namespace of [USER, PLAN, LINK, MODERATION] as Namespace<object>[]) {
          for (const { object, state } of namespace.objects.values()) {
            if (state.alarm !== null && state.alarm <= now && "alarm" in object) {
              state.alarm = null;
              await (object as { alarm: () => Promise<void> }).alarm();
              ran = true;
            }
          }
        }
        if (!ran) return;
      }
    },
  };
}
