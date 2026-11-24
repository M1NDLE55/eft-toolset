import { moderationObject, planObject, userObject, type DurableBindings } from "@/app/lib/durable/access";
import type { Decision, ReportReason } from "@/app/lib/durable/moderation-store";
import { clientIp } from "@/app/lib/api/rate-limit";
import { logCode } from "@/app/lib/sharing/link-code";
import { bindings, fail, json, NOINDEX, readJson, requireSameOrigin, route, unwrapOutcome } from "./http";
import { resolveCode } from "./link-routes";
import { hashedIp } from "./secrets";
import { callerSession, withSession } from "./session";
import { recordRequestUsage } from "@/app/lib/usage/record";

/**
 * The "Report" button (§16.6). Anyone who can see the content can report it: /s/ visitors signed in
 * or not, plan members, invite holders (for the plan behind the invite), and agents. Owners can't
 * report their own items. One report per reporter per subject; 10 an hour (per account, or per
 * hashed IP when signed out). Three distinct reporters within 7 days pause a public link until an
 * admin reviews it.
 */

export type ReportSubject = { link: string } | { plan: string } | { invite: string };

interface Resolved {
  subject: string;
  targetKind: "user" | "plan";
  targetName: string;
  item: string | null;
  code: string | null;
}

async function resolveSubject(env: DurableBindings, input: ReportSubject, viewerId: string | null): Promise<Resolved> {
  if ("link" in input && typeof input.link === "string") {
    const target = await resolveCode(env, input.link);
    if (!target) fail("not_found", "That link doesn't exist.");
    if (target.targetKind === "user") {
      const link = await userObject(env, target.targetName).link(input.link);
      if (!link || link.status === "revoked" || link.status === "expired") fail("gone", "That link no longer works.");
      if (viewerId === target.targetName) fail("forbidden", "You can't report your own items.");
      return { subject: `link:${input.link}`, targetKind: "user", targetName: target.targetName, item: `${link.targetType}:${link.targetId}`, code: input.link };
    }
    const plan = planObject(env, target.targetName);
    unwrapOutcome(await plan.openLink(input.link, null));
    if (viewerId && (await plan.ownerId()) === viewerId) fail("forbidden", "You can't report your own plan.");
    return { subject: `link:${input.link}`, targetKind: "plan", targetName: target.targetName, item: null, code: input.link };
  }
  if ("invite" in input && typeof input.invite === "string") {
    const target = await resolveCode(env, input.invite);
    if (!target || target.targetKind !== "plan") fail("not_found", "That invite doesn't exist.");
    unwrapOutcome(await planObject(env, target.targetName).previewInvite(input.invite));
    if (viewerId && (await planObject(env, target.targetName).ownerId()) === viewerId) fail("forbidden", "You can't report your own plan.");
    return { subject: `plan:${target.targetName}`, targetKind: "plan", targetName: target.targetName, item: null, code: null };
  }
  if ("plan" in input && typeof input.plan === "string") {
    if (!viewerId) fail("unauthenticated", "Sign in to report a plan you're a member of.");
    const role = await planObject(env, input.plan).memberRole(viewerId);
    if (!role) fail("not_found", "That plan doesn't exist, or isn't shared with you.");
    if (role === "owner") fail("forbidden", "You can't report your own plan.");
    return { subject: `plan:${input.plan}`, targetKind: "plan", targetName: input.plan, item: null, code: null };
  }
  return fail("invalid", "Say what you're reporting: a link, a plan or an invite.");
}

/** Files a report; shared by the HTTP route and the report_content MCP tool. */
export async function fileReport(
  env: DurableBindings,
  reporter: { userId: string } | { ip: string | null },
  input: ReportSubject & { reason: string; detail?: string | null }
): Promise<{ received: true }> {
  const viewerId = "userId" in reporter ? reporter.userId : null;
  const resolved = await resolveSubject(env, input, viewerId);
  const moderation = moderationObject(env);
  let reporterKey: string;
  const refund = async () => {
    if ("userId" in reporter) await userObject(env, reporter.userId).refund("reports");
  };
  if ("userId" in reporter) {
    unwrapOutcome(await userObject(env, reporter.userId).charge("reports"));
    reporterKey = `user:${reporter.userId}`;
  } else {
    reporterKey = `ip:${await hashedIp(reporter.ip ?? "unknown")}`;
    unwrapOutcome(await moderation.chargeAnonymous(reporterKey));
  }
  const detail = typeof input.detail === "string" && input.detail.trim() ? input.detail.trim().slice(0, 500) : null;
  const outcome = await moderation.report({ subject: resolved.subject, targetKind: resolved.targetKind, targetName: resolved.targetName, item: resolved.item, reason: input.reason as ReportReason, detail, reporter: reporterKey });
  if (!outcome.ok) await refund();
  const result = unwrapOutcome(outcome);
  if (result.pause && resolved.code) await pauseLink(env, resolved, true);
  if (!result.duplicate) await alert(resolved.subject, input.reason);
  console.info(JSON.stringify({ event: "report", subject: await logCode(resolved.subject), reason: input.reason, paused: result.pause }));
  return { received: true };
}

async function pauseLink(env: DurableBindings, resolved: Resolved, paused: boolean) {
  if (!resolved.code) return;
  if (resolved.targetKind === "user") await userObject(env, resolved.targetName).setLinkPaused(resolved.code, paused);
  else {
    await planObject(env, resolved.targetName).setLinkPaused(resolved.code, paused);
    const owner = await planObject(env, resolved.targetName).ownerId();
    if (owner && paused) await userObject(env, owner).addNotice("moderation", "A link to one of your plans was paused after reports. It shows as under review until it is checked.");
  }
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  await cache?.delete(`https://cache.eft-toolset.internal/snapshot/${resolved.code}`).catch(() => false);
}

/** An optional alert for a new report: no content, no reporter, just the subject's hash, reason and count. */
async function alert(subject: string, reason: string) {
  const url = process.env.REPORT_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `New report (${reason}) on ${await logCode(subject)}.` }), signal: AbortSignal.timeout(3000) });
  } catch {
    // Best effort.
  }
}

/** POST /api/reports: { link | plan | invite, reason, detail? } — signed in or not. */
export function postReport(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const body = await readJson<ReportSubject & { reason?: string; detail?: string }>(request, 8 * 1024);
    const session = await callerSession(request);
    const reporter = session.kind === "user" ? { userId: session.userId } : { ip: clientIp(request) };
    const result = await fileReport(bindings(), reporter, { ...body, reason: String(body.reason ?? "") });
    recordRequestUsage(request, { name: "report.file" }, session.kind === "user" ? session.userId : undefined);
    return withSession(json(result, 200, NOINDEX), session.kind === "user" ? session : null);
  }, NOINDEX);
}

// Admin (§16.6): behind ADMIN_TOKEN, a Wrangler secret. Off (404) without it.

function requireAdmin(request: Request) {
  const token = process.env.ADMIN_TOKEN?.trim() ?? "";
  if (token.length < 32) fail("not_found", "Not found.");
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  let difference = given.length ^ token.length;
  for (let index = 0; index < Math.max(given.length, token.length); index += 1) difference |= (given.charCodeAt(index) || 0) ^ (token.charCodeAt(index) || 0);
  if (difference !== 0) fail("unauthenticated", "Admin token required.");
}

async function reviewContent(env: DurableBindings, row: { subject: string; targetKind: "user" | "plan"; targetName: string }) {
  try {
    if (row.subject.startsWith("link:") && row.targetKind === "user") {
      const opened = await userObject(env, row.targetName).openLink(row.subject.slice(5), true);
      return opened.ok ? opened.value.snapshot : { unavailable: opened.error.message };
    }
    return await planObject(env, row.targetName).reviewSnapshot();
  } catch {
    return { unavailable: "Couldn't load the content." };
  }
}

/** GET /admin/reports: open and paused cases, with the reported content. */
export function getAdminReports(request: Request) {
  return route(async () => {
    requireAdmin(request);
    const env = bindings();
    const cases = await moderationObject(env).queue();
    const withContent = await Promise.all(cases.map(async (row) => ({ ...row, content: await reviewContent(env, row) })));
    return json({ cases: withContent }, 200, NOINDEX);
  }, NOINDEX);
}

/**
 * POST /admin/reports/:subject: { decision }. Dismiss un-pauses the link and closes the case;
 * disable_link revokes it (marked as admin-revoked); disable_target disables the plan, build or
 * group for everyone but its owner. The owner gets a notice for both disable decisions.
 */
export function postAdminDecision(request: Request, encodedSubject: string) {
  return route(async () => {
    requireAdmin(request);
    const env = bindings();
    const subject = decodeURIComponent(encodedSubject);
    const body = await readJson<{ decision?: Decision }>(request);
    const decided = unwrapOutcome(await moderationObject(env).decide(subject, body.decision as Decision));
    const code = subject.startsWith("link:") ? subject.slice(5) : null;
    const resolved: Resolved = { subject, targetKind: decided.targetKind, targetName: decided.targetName, item: decided.item, code };
    if (decided.decision === "dismiss") await pauseLink(env, resolved, false);
    if (decided.decision === "disable_link" && code) {
      if (decided.targetKind === "user") await userObject(env, decided.targetName).revokeLink(code, true);
      else await planObject(env, decided.targetName).revokeLink("", code, true);
      const owner = decided.targetKind === "user" ? decided.targetName : await planObject(env, decided.targetName).ownerId();
      if (owner) await userObject(env, owner).addNotice("moderation", "A link to one of your items was removed after review.");
    }
    if (decided.decision === "disable_target") {
      if (decided.targetKind === "plan") {
        await planObject(env, decided.targetName).setState("disabled");
        const owner = await planObject(env, decided.targetName).ownerId();
        if (owner) await userObject(env, owner).addNotice("moderation", "One of your plans was removed after review. Only you can see it now.");
      } else if (decided.item) {
        const [kind, id] = decided.item.split(":") as ["build" | "item_group", string];
        await userObject(env, decided.targetName).setItemState(kind, id, "disabled");
      }
    }
    return json({ case: decided }, 200, NOINDEX);
  }, NOINDEX);
}
