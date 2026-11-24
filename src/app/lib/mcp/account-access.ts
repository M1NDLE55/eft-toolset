import { userObject, type DurableBindings } from "@/app/lib/durable/access";
import { DomainError } from "@/app/lib/durable/sql";
import { platform } from "@/app/lib/server/platform";
import { newOperationId } from "@/app/lib/sharing/ids";
import type { LibraryRecord, Mutation, MutationResult } from "@/app/lib/sharing/types";
import { InputError, type ToolContext } from "./context";

/** Shared by the account tools and the tools that read account plans and saved builds. */

export function env(): DurableBindings {
  const durable = platform().durable;
  if (!durable) throw new InputError("Accounts aren't available on this server.");
  return durable;
}

export function userOf(context: ToolContext) {
  if (!context.userId) throw new DomainError("forbidden", "Sign in to use your library and shared plans.");
  return context.userId;
}

/** Applies one mutation; conflicts come back as a structured error with both versions (§13). */
export async function mutate(userId: string, mutation: Mutation): Promise<Extract<MutationResult, { status: "applied" }>> {
  const outcome = await userObject(env(), userId).applyMutations([mutation], "mcp");
  if (!outcome.ok) throw new DomainError(outcome.error.code, outcome.error.message, outcome.error.details);
  const [result] = outcome.value;
  if (result.status === "applied") return result;
  if (result.status === "conflict") {
    throw new DomainError("conflict", "It changed since that version: the same fields were edited elsewhere. Show both to the person, or re-apply your change to theirs and retry with its version.", {
      fields: result.fields,
      yours: result.mine,
      theirs: result.theirs,
    });
  }
  throw new DomainError(result.code === "gone" ? "not_found" : result.code, result.message, result.details);
}

export function requestRef(requestId: string | undefined) {
  return requestId ? `mcp-${requestId}` : newOperationId();
}

export function recordUrl(origin: string, record: LibraryRecord) {
  if (record.kind === "build") return `${origin}/gun-builder/${record.id}`;
  if (record.kind === "item_group") return `${origin}/item-groups/${encodeURIComponent(record.name)}`;
  return `${origin}/raid-planner/p/${record.id}`;
}

/** A link as callers give it: /s/<code>, /join#<code>, a plan URL, a legacy share link, or a bare code. */
export type ParsedLink =
  | { kind: "share"; code: string }
  | { kind: "invite"; code: string }
  | { kind: "plan"; planId: string }
  | { kind: "legacy-build"; link: string }
  | { kind: "legacy-plan"; link: string }
  | { kind: "code"; code: string };

export function parseLink(input: string): ParsedLink {
  const text = input.trim();
  const code = "([1-9A-Za-z][A-Za-z0-9_-]{20})";
  let match = new RegExp(`/s/${code}(?:[/?#]|$)`).exec(text);
  if (match) return { kind: "share", code: match[1] };
  match = new RegExp(`/join#${code}$`).exec(text);
  if (match) return { kind: "invite" as const, code: match[1] };
  match = /\/raid-planner\/p\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(text);
  if (match) return { kind: "plan", planId: match[1] };
  if (/#b=|\/gun-builder\/share\//.test(text)) return { kind: "legacy-build", link: text };
  if (/#p=|\/raid-planner\/share\//.test(text)) return { kind: "legacy-plan", link: text };
  if (new RegExp(`^${code}$`).test(text)) return { kind: "code", code: text };
  if (/^[A-Za-z0-9_-]{22}$/.test(text)) return { kind: "plan", planId: text };
  throw new InputError("That isn't a link this site makes: use an /s/ link, an invite (/join#…), a plan URL, or a share link.");
}

export function planIdOf(input: string) {
  const parsed = parseLink(input);
  if (parsed.kind !== "plan") throw new InputError("Give the plan's id or its /raid-planner/p/ URL.");
  return parsed.planId;
}

