// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { moderationObject, planObject, userObject } from "@/app/lib/durable/access";
import { fileReport } from "@/app/lib/sharing/server/report-routes";
import { createLink, openShare } from "@/app/lib/sharing/server/link-routes";
import { acceptInvite, createAccountPlan } from "@/app/lib/sharing/server/plan-service";
import { sharingEndpoint } from "@/app/lib/sharing/server/router";
import { newRecordId } from "@/app/lib/sharing/ids";
import type { BuildValue } from "@/app/lib/sharing/types";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { durableEnv } from "./helpers/durable-env";

const ORIGIN = "http://localhost:3000";
const ADMIN = "an-admin-token-that-is-at-least-32-characters";
const weapon = "5447a9cd4bdc2dbd208b4567";
const build: BuildValue = { name: "Spam build", weaponId: weapon, root: { itemId: weapon, slots: {} } };
const plan: PlanContent = { name: "Plan", mapKey: "customs", enabledLayers: [], route: [], drawings: [], notes: [] };

let durable: ReturnType<typeof durableEnv>;
const env = () => durable.env;

async function sharedBuild() {
  const id = newRecordId();
  await userObject(env(), "user_owner").applyMutations([{ mutationId: newRecordId(), kind: "build", op: "create", id, value: build }]);
  const link = await createLink(env(), "user_owner", { target: { type: "build", id }, access: "copy" }, new Request(ORIGIN));
  return { id, code: link.code };
}

function admin(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}), "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return sharingEndpoint(request)!(request);
}

beforeEach(() => {
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
  vi.stubEnv("ADMIN_TOKEN", ADMIN);
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("reporting", () => {
  it("takes one report per reporter per subject, and pauses a public link after 3 distinct reporters", async () => {
    const { code } = await sharedBuild();
    await fileReport(env(), { userId: "user_a" }, { link: code, reason: "spam" });
    await fileReport(env(), { userId: "user_a" }, { link: code, reason: "offensive" });
    await fileReport(env(), { ip: "203.0.113.5" }, { link: code, reason: "spam" });
    expect((await moderationObject(env()).caseRow(`link:${code}`))).toMatchObject({ status: "open", reporters: 2 });
    expect((await openShare(env(), code, null)).access).toBe("copy");

    await fileReport(env(), { userId: "user_b" }, { link: code, reason: "spam", detail: "x".repeat(900) });
    const row = await moderationObject(env()).caseRow(`link:${code}`);
    expect(row).toMatchObject({ status: "paused", reporters: 3 });
    expect(row!.reports.at(-1)!.detail).toHaveLength(500);
    await expect(openShare(env(), code, null)).rejects.toThrow(/under review/);
    // The owner still sees their own link, and gets a notice that never names reporters.
    expect((await openShare(env(), code, "user_owner")).access).toBe("copy");
    const notices = (await userObject(env(), "user_owner").library()).notices;
    expect(notices[0].body).toMatch(/paused after reports/);
    expect(JSON.stringify(notices)).not.toMatch(/user_a|user_b|203\.0/);
  });

  it("counts only reporters from the last 7 days toward a pause", async () => {
    const { code } = await sharedBuild();
    vi.useFakeTimers();
    await fileReport(env(), { userId: "user_a" }, { link: code, reason: "spam" });
    await fileReport(env(), { userId: "user_b" }, { link: code, reason: "spam" });
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60_000);
    await fileReport(env(), { userId: "user_c" }, { link: code, reason: "spam" });
    expect(await moderationObject(env()).caseRow(`link:${code}`)).toMatchObject({ status: "open", reporters: 3 });
  });

  it("won't let owners report their own items, and lets only members and invite holders report a plan", async () => {
    const { code } = await sharedBuild();
    await expect(fileReport(env(), { userId: "user_owner" }, { link: code, reason: "spam" })).rejects.toThrow(/your own/);
    const { planId } = await createAccountPlan(env(), "user_owner", plan, { kind: "create" });
    await expect(fileReport(env(), { userId: "user_stranger" }, { plan: planId, reason: "spam" })).rejects.toThrow(/doesn't exist/);
    await expect(fileReport(env(), { ip: "198.51.100.1" }, { plan: planId, reason: "spam" })).rejects.toThrow(/Sign in/);
    const invite = (await createLink(env(), "user_owner", { target: { type: "plan", id: planId }, access: "invite", role: "viewer", maxUses: 5 }, new Request(ORIGIN))).code;
    await fileReport(env(), { ip: "198.51.100.1" }, { invite, reason: "offensive" });
    await acceptInvite(env(), "user_member", invite);
    await fileReport(env(), { userId: "user_member" }, { plan: planId, reason: "offensive" });
    await expect(fileReport(env(), { userId: "user_owner" }, { plan: planId, reason: "spam" })).rejects.toThrow(/your own/);
    // Members keep their access: a report on a plan never pauses it.
    expect(await moderationObject(env()).caseRow(`plan:${planId}`)).toMatchObject({ status: "open", reporters: 2 });
  });

  it("limits reports to 5 at once, then 10 an hour, per account and per address", async () => {
    const links = await Promise.all(Array.from({ length: 6 }, async (_, index) => (await createLink(env(), `user_owner${index}`, { target: { type: "build", id: (await ownBuild(`user_owner${index}`)) }, access: "view" }, new Request(ORIGIN))).code));
    for (const code of links.slice(0, 5)) await fileReport(env(), { userId: "user_reporter" }, { link: code, reason: "spam" });
    await expect(fileReport(env(), { userId: "user_reporter" }, { link: links[5], reason: "spam" })).rejects.toThrow(/Too many/);
    for (const code of links.slice(0, 5)) await fileReport(env(), { ip: "192.0.2.9" }, { link: code, reason: "spam" });
    await expect(fileReport(env(), { ip: "192.0.2.9" }, { link: links[5], reason: "spam" })).rejects.toThrow(/Too many reports/);
  });

  it("refuses unknown reasons and links that don't exist", async () => {
    const { code } = await sharedBuild();
    await expect(fileReport(env(), { userId: "user_a" }, { link: code, reason: "boring" })).rejects.toThrow(/reason/);
    await expect(fileReport(env(), { userId: "user_a" }, { link: "1aaaaaaaaaaaaaaaaaaaa", reason: "spam" })).rejects.toThrow(/doesn't exist/);
  });
});

async function ownBuild(userId: string) {
  const id = newRecordId();
  await userObject(env(), userId).applyMutations([{ mutationId: newRecordId(), kind: "build", op: "create", id, value: build }]);
  return id;
}

describe("admin review", () => {
  it("needs the admin token, and is off without one", async () => {
    expect((await admin("/admin/reports")).status).toBe(401);
    expect((await admin("/admin/reports", { token: "wrong" })).status).toBe(401);
    vi.stubEnv("ADMIN_TOKEN", "");
    expect((await admin("/admin/reports", { token: ADMIN })).status).toBe(404);
  });

  it("lists cases with their content, and dismiss un-pauses a link", async () => {
    const { code } = await sharedBuild();
    for (const reporter of ["user_a", "user_b", "user_c"]) await fileReport(env(), { userId: reporter }, { link: code, reason: "spam" });
    const queue = (await (await admin("/admin/reports", { token: ADMIN })).json()) as { cases: { subject: string; content: { name: string } }[] };
    expect(queue.cases).toEqual([expect.objectContaining({ subject: `link:${code}`, content: expect.objectContaining({ name: "Spam build" }) })]);
    expect(JSON.stringify(queue)).not.toMatch(/user_a|user_b/);
    const response = await admin(`/admin/reports/${encodeURIComponent(`link:${code}`)}`, { method: "POST", token: ADMIN, body: { decision: "dismiss" } });
    expect(response.status).toBe(200);
    expect((await openShare(env(), code, null)).access).toBe("copy");
    // A dismissal sticks: one new report doesn't pause it again on the strength of the old ones.
    await fileReport(env(), { userId: "user_d" }, { link: code, reason: "spam" });
    expect((await openShare(env(), code, null)).access).toBe("copy");
    expect(await moderationObject(env()).caseRow(`link:${code}`)).toMatchObject({ status: "open" });
  });

  it("disables a link, or the item itself, for everyone but its owner", async () => {
    const first = await sharedBuild();
    await fileReport(env(), { userId: "user_a" }, { link: first.code, reason: "spam" });
    await admin(`/admin/reports/${encodeURIComponent(`link:${first.code}`)}`, { method: "POST", token: ADMIN, body: { decision: "disable_link" } });
    await expect(openShare(env(), first.code, null)).rejects.toThrow(/removed after review/);

    const second = await sharedBuild();
    await fileReport(env(), { userId: "user_a" }, { link: second.code, reason: "offensive" });
    await admin(`/admin/reports/${encodeURIComponent(`link:${second.code}`)}`, { method: "POST", token: ADMIN, body: { decision: "disable_target" } });
    await expect(openShare(env(), second.code, null)).rejects.toThrow(/removed after review/);
    expect(await userObject(env(), "user_owner").record("build", second.id)).toMatchObject({ name: "Spam build" });

    const { planId } = await createAccountPlan(env(), "user_owner", plan, { kind: "create" });
    const invite = (await createLink(env(), "user_owner", { target: { type: "plan", id: planId }, access: "invite", role: "editor" }, new Request(ORIGIN))).code;
    await acceptInvite(env(), "user_member", invite);
    await fileReport(env(), { userId: "user_member" }, { plan: planId, reason: "offensive" });
    await admin(`/admin/reports/${encodeURIComponent(`plan:${planId}`)}`, { method: "POST", token: ADMIN, body: { decision: "disable_target" } });
    const member = await planObject(env(), planId).snapshot("user_member");
    expect(member.ok ? null : member.error.message).toMatch(/removed after review/);
    expect((await planObject(env(), planId).snapshot("user_owner")).ok).toBe(true);
    expect((await userObject(env(), "user_owner").library()).notices[0].body).toMatch(/removed after review/);
  });
});
