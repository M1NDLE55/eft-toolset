import type { SignInIntent } from "@/app/lib/account/sealed-state";
import { platform } from "@/app/lib/server/platform";
import { DomainError } from "@/app/lib/durable/sql";
import { RouteError } from "./http";
import { copyFromLink, libraryUrl } from "./link-routes";
import { acceptInvite } from "./plan-service";
import { recordRequestUsage } from "@/app/lib/usage/record";

/**
 * Completes what a visitor started before signing in (§14.1, §14.2): the server derives where to go
 * from the result, so no redirect target ever comes from the client. Failures land back on the page
 * the visitor came from, with the reason.
 */
export async function finishIntent(request: Request, userId: string, intent: SignInIntent): Promise<string> {
  const env = platform().durable;
  const failure = async (error: unknown) => {
    const code = await errorCode(error);
    return intent.kind === "copy" ? `/s/${intent.code}?error=${code}` : `/join?error=${code}#${intent.code}`;
  };
  if (!env) return failure(new DomainError("invalid", "Accounts aren't available here."));
  try {
    if (intent.kind === "copy") {
      const copied = await copyFromLink(env, userId, intent.code);
      recordRequestUsage(request, { name: "link.copy" }, userId);
      return `${libraryUrl(copied)}?saved=1`;
    }
    const joined = await acceptInvite(env, userId, intent.code);
    if (joined.joined) recordRequestUsage(request, { name: "link.join" }, userId);
    return `/raid-planner/p/${joined.planId}`;
  } catch (error) {
    return failure(error);
  }
}

async function errorCode(error: unknown): Promise<string> {
  if (error instanceof DomainError) return error.code;
  if (error instanceof RouteError) {
    if (error.code) return error.code;
    try {
      const body = (await error.response.clone().json()) as { error?: { code?: string } };
      return body.error?.code ?? "invalid";
    } catch {
      return "invalid";
    }
  }
  console.error("Finishing a sign-in intent failed", error);
  return "invalid";
}
