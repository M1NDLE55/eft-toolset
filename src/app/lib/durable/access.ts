import type { LinkDO } from "./link-do";
import type { ModerationDO } from "./moderation-do";
import type { PlanDO } from "./plan-do";
import type { UserDO } from "./user-do";

/**
 * How the rest of the Worker reaches per-user, per-plan and per-link state. Users are named by
 * their WorkOS user id (the MCP token's sub, the website session's user), so the same object serves
 * the website, every MCP client and every reconnect. Durable Objects can only be reached through
 * these bindings, never from the Internet; the Worker authenticates the caller and passes the
 * verified user id, and the objects trust only that.
 */
export interface DurableBindings {
  USER: DurableObjectNamespace<UserDO>;
  PLAN: DurableObjectNamespace<PlanDO>;
  LINK: DurableObjectNamespace<LinkDO>;
  MODERATION: DurableObjectNamespace<ModerationDO>;
}

/** The report queue: one object for the whole site. */
export function moderationObject(env: Pick<DurableBindings, "MODERATION">) {
  return env.MODERATION.getByName("moderation") as unknown as Remote<ModerationDO>;
}

/**
 * A stub's methods as the object declares them, made async. Workers' own stub types re-check every
 * value as RPC-serialisable and collapse anything typed `unknown` (a setting's JSON value, a
 * snapshot) to `never`; our values are plain JSON, which RPC carries.
 */
export type Remote<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

export function userObject(env: Pick<DurableBindings, "USER">, userId: string) {
  return env.USER.getByName(userId) as unknown as Remote<UserDO>;
}

export function planObject(env: Pick<DurableBindings, "PLAN">, planId: string) {
  return env.PLAN.getByName(planId) as unknown as Remote<PlanDO>;
}

export function linkObject(env: Pick<DurableBindings, "LINK">, code: string) {
  return env.LINK.getByName(code) as unknown as Remote<LinkDO>;
}
