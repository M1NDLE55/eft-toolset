// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { sharingEndpoint } from "@/app/lib/sharing/server/router";
import { authCallback, signInWithIntent } from "@/app/lib/account/routes";
import { STATE_COOKIE } from "@/app/lib/account/cookies";
import { USAGE_COLUMNS } from "@/app/lib/usage/catalog";
import type { UsageDataPoint } from "@/app/lib/usage/record";
import type { BuildValue } from "@/app/lib/sharing/types";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { durableEnv } from "./helpers/durable-env";

// The sharing events in the usage stats: recorded when a website request succeeds, with nothing
// that names the account, the link or the content.

const ORIGIN = "http://localhost:3000";
const weapon = "5447a9cd4bdc2dbd208b4567";
const build: BuildValue = { name: "Private build name", weaponId: weapon, root: { itemId: weapon, slots: {} } };
const plan: PlanContent = { name: "Private plan name", mapKey: "customs", enabledLayers: [], route: [], drawings: [], notes: [] };

let written: UsageDataPoint[];
let pending: Promise<unknown>[];

async function call(path: string, init: { method?: string; user?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", origin: ORIGIN };
  if (init.user) headers.cookie = `eft_dev_user=${init.user}`;
  const request = new Request(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const response = await sharingEndpoint(request)!(request);
  while (pending.length) await Promise.all(pending.splice(0));
  return response;
}

const events = () => written.map((point) => point.blobs[0]);
const column = (point: UsageDataPoint, name: keyof typeof USAGE_COLUMNS) => point.blobs[Number(USAGE_COLUMNS[name].slice(4)) - 1];

beforeEach(() => {
  vi.stubEnv("DEV_AUTH", "1");
  resetRequestBudgets();
  written = [];
  pending = [];
  setPlatform({ durable: durableEnv().env as never, writeUsage: (point) => void written.push(point), waitUntil: (promise) => void pending.push(promise) });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
});

describe("sharing usage events", () => {
  it("counts links made, copied and joined, plans hosted and reports filed, once each", async () => {
    const mutation = { mutationId: "create-build-1", kind: "build", op: "create", id: "BBBBBBBBBBBBBBBBBBBBBB", value: build };
    expect((await call("/api/library/mutations", { method: "POST", user: "owner", body: { mutations: [mutation] } })).status).toBe(200);
    const link = (await (await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "build", id: mutation.id }, access: "copy" } })).json()) as { code: string };
    expect((await call(`/api/s/${link.code}/copy`, { method: "POST", user: "visitor", body: {} })).status).toBe(201);
    expect(events()).toEqual(["link.create", "link.copy"]);

    // A second create with the same id is refused, and not counted.
    const hosted = { content: plan, id: "PPPPPPPPPPPPPPPPPPPPPP" };
    const created = (await (await call("/api/plans", { method: "POST", user: "owner", body: hosted })).json()) as { planId: string };
    expect((await call("/api/plans", { method: "POST", user: "owner", body: hosted })).status).toBe(400);
    const invite = (await (await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "plan", id: created.planId }, access: "invite", role: "editor" } })).json()) as {
      code: string;
    };
    // Accepting twice joins once.
    for (let attempt = 0; attempt < 2; attempt += 1) expect((await call("/api/invites/accept", { method: "POST", user: "member", body: { code: invite.code } })).status).toBe(200);
    expect((await call("/api/reports", { method: "POST", body: { link: link.code, reason: "spam", detail: "free text never stored" } })).status).toBe(200);
    expect(events()).toEqual(["link.create", "link.copy", "plan.host", "link.create", "link.join", "report.file"]);

    const host = written[2];
    expect([column(host, "subjectKind"), column(host, "subject")]).toEqual(["map", "customs"]);
    for (const point of written) expect([column(point, "source"), column(point, "feature")]).toEqual(["server", "sharing"]);
    const stored = JSON.stringify(written);
    for (const secret of ["owner", "visitor", "member", link.code, invite.code, created.planId, mutation.id, build.name, plan.name, "free text"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("counts nothing for a refused request", async () => {
    expect((await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "build", id: "missing" }, access: "copy" } })).status).toBe(404);
    expect((await call("/api/invites/accept", { method: "POST", user: "member", body: { code: "1notavalidcodeatall00" } })).status).toBeGreaterThanOrEqual(400);
    expect(events()).toEqual([]);
  });

  it("counts a copy finished after sign-in", async () => {
    const mutation = { mutationId: "create-build-2", kind: "build", op: "create", id: "CCCCCCCCCCCCCCCCCCCCCC", value: build };
    await call("/api/library/mutations", { method: "POST", user: "owner", body: { mutations: [mutation] } });
    const link = (await (await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "build", id: mutation.id }, access: "copy" } })).json()) as { code: string };
    const started = await signInWithIntent(
      new Request(`${ORIGIN}/auth/sign-in`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify({ intent: "copy", code: link.code }) })
    );
    const state = new URL(((await started.json()) as { url: string }).url).searchParams.get("state")!;
    const cookie = /eft_auth_state=([^;]+)/.exec(started.headers.get("set-cookie") ?? "")![1];
    const landed = await authCallback(new Request(`${ORIGIN}/auth/callback?state=${state}&dev_user=visitor`, { headers: { cookie: `${STATE_COOKIE}=${cookie}` } }));
    expect(landed.headers.get("location")).toContain("?saved=1");
    while (pending.length) await Promise.all(pending.splice(0));
    expect(events()).toEqual(["link.create", "account.sign_in", "link.copy"]);
  });
});
