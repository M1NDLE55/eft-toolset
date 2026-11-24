// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { safeReturnPath } from "@/app/lib/sharing/return-path";
import { sealState, unsealState } from "@/app/lib/account/sealed-state";
import { createLink, copyFromLink, openShare, revokeLink } from "@/app/lib/sharing/server/link-routes";
import { sharingEndpoint } from "@/app/lib/sharing/server/router";
import { authCallback, signInWithIntent } from "@/app/lib/account/routes";
import { STATE_COOKIE } from "@/app/lib/account/cookies";
import { newRecordId } from "@/app/lib/sharing/ids";
import { createLinkCode } from "@/app/lib/sharing/link-code";
import { linkKeys } from "@/app/lib/sharing/server/secrets";
import { userObject } from "@/app/lib/durable/access";
import type { BuildValue } from "@/app/lib/sharing/types";
import { durableEnv } from "./helpers/durable-env";

const ORIGIN = "http://localhost:3000";
const weapon = "5447a9cd4bdc2dbd208b4567";
const build: BuildValue = { name: "Shared M4", weaponId: weapon, root: { itemId: weapon, slots: { mod_stock: { itemId: "stock", slots: {} } } } };

function call(path: string, init: { method?: string; user?: string; body?: unknown; origin?: string | null; cookies?: Record<string, string> } = {}) {
  const cookies = { ...(init.user ? { eft_dev_user: init.user } : {}), ...init.cookies };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headers.cookie = cookie;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  const request = new Request(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const handler = sharingEndpoint(request);
  if (!handler) throw new Error(`No route for ${path}`);
  return handler(request);
}

let durable: ReturnType<typeof durableEnv>;

async function ownBuild(userId: string) {
  const id = newRecordId();
  const result = await userObject(durable.env, userId).applyMutations([{ mutationId: newRecordId(), kind: "build", op: "create", id, value: build }]);
  expect(result.ok && result.value[0].status).toBe("applied");
  return id;
}

beforeEach(() => {
  vi.stubEnv("DEV_AUTH", "1");
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
});

describe("sign-in return paths", () => {
  it("allows only paths on this site under the allowlisted prefixes", () => {
    expect(safeReturnPath("/gun-builder/abc?x=1#frag")).toBe("/gun-builder/abc?x=1");
    expect(safeReturnPath("/s/1abcdefghijklmnopqrst")).toBe("/s/1abcdefghijklmnopqrst");
    expect(safeReturnPath("/settings")).toBe("/settings");
    for (const bad of [
      "",
      "gun-builder",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/gun-builder",
      "/gun-builder\\..\\admin",
      "/gun-builder\n/x",
      "/gun-builderish",
      "/admin",
      "/api/library",
      "/%2F%2Fevil.example",
      "/" + "a".repeat(600),
      "/s",
    ]) {
      expect(safeReturnPath(bad), bad).toBe("/settings#account");
    }
  });
});

describe("sealed sign-in state", () => {
  const password = "a-test-cookie-password-of-at-least-32-chars";

  it("round-trips, and refuses altered, foreign or expired cookies", async () => {
    const sealed = await sealState({ state: "s1", intent: { kind: "copy", code: "1abc" }, expiresAt: Date.now() + 60_000 }, password);
    expect(await unsealState(sealed, password)).toMatchObject({ state: "s1", intent: { kind: "copy", code: "1abc" } });
    expect(await unsealState(sealed.slice(0, -3) + "AAA", password)).toBeNull();
    expect(await unsealState(sealed, `${password}-other`)).toBeNull();
    const expired = await sealState({ state: "s1", expiresAt: Date.now() - 1 }, password);
    expect(await unsealState(expired, password)).toBeNull();
  });
});

describe("view and copy links", () => {
  it("lets anyone open a copy link and a signed-in visitor save a copy with their own defaults", async () => {
    const id = await ownBuild("user_owner");
    const request = new Request(`${ORIGIN}/api/links`);
    const link = await createLink(durable.env, "user_owner", { target: { type: "build", id }, access: "copy" }, request);
    expect(link.url).toMatch(new RegExp(`^${ORIGIN}/s/[1-9A-Za-z][A-Za-z0-9_-]{20}$`));

    const opened = await openShare(durable.env, link.code, null);
    expect(opened).toMatchObject({ targetType: "build", access: "copy", allowCopy: true, snapshot: { name: "Shared M4" } });
    expect(opened.ownerDisplayName).toMatch(/^Scav-\d{4}$/);

    const copied = await copyFromLink(durable.env, "user_visitor", link.code);
    const record = await userObject(durable.env, "user_visitor").record("build", copied.id);
    expect(record).toMatchObject({ name: "Shared M4", origin: "copy", copiedFrom: "Shared M4", allowCopy: true });
    expect(await userObject(durable.env, "user_owner").link(link.code)).toMatchObject({ opens: 1, copies: 1 });
  });

  it("refuses copies when the owner turns them off, and acts as a view link until they turn them back on", async () => {
    const id = await ownBuild("user_owner");
    const link = await createLink(durable.env, "user_owner", { target: { type: "build", id }, access: "copy" }, new Request(ORIGIN));
    await userObject(durable.env, "user_owner").setAllowCopy("build", id, false);
    expect((await openShare(durable.env, link.code, null)).access).toBe("view");
    await expect(copyFromLink(durable.env, "user_visitor", link.code)).rejects.toThrow();
    await userObject(durable.env, "user_owner").setAllowCopy("build", id, true);
    expect((await openShare(durable.env, link.code, null)).access).toBe("copy");
  });

  it("turns away forged codes without touching a Durable Object, and revokes at once", async () => {
    const forged = `1${newRecordId().slice(0, 20)}`;
    const response = await call(`/api/s/${forged}`);
    expect(response.status).toBe(404);
    expect(durable.LINK.objects.size).toBe(0);

    const id = await ownBuild("user_owner");
    const link = await createLink(durable.env, "user_owner", { target: { type: "build", id }, access: "view" }, new Request(ORIGIN));
    await expect(revokeLink(durable.env, "user_other", link.code)).rejects.toThrow();
    await revokeLink(durable.env, "user_owner", link.code);
    const gone = await call(`/api/s/${link.code}`);
    expect(gone.status).toBe(410);
    expect(gone.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("needs the owner for every link change, and same-origin requests", async () => {
    const id = await ownBuild("user_owner");
    expect((await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "build", id }, access: "copy" }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/api/links", { method: "POST", body: { target: { type: "build", id }, access: "copy" } })).status).toBe(401);
    // Another user can't link someone else's build: it isn't in their library.
    expect((await call("/api/links", { method: "POST", user: "mallory", body: { target: { type: "build", id }, access: "copy" } })).status).toBe(404);
    const invite = await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "build", id }, access: "invite" } });
    expect(invite.status).toBe(400);
  });

  it("serves the snapshot route, and copies for a signed-in caller", async () => {
    const created = await call("/api/library/mutations", {
      method: "POST",
      user: "owner",
      body: { mutations: [{ mutationId: "create-build-1", kind: "build", op: "create", id: "BBBBBBBBBBBBBBBBBBBBBB", value: build }] },
    });
    expect(created.status).toBe(200);
    const link = (await (await call("/api/links", { method: "POST", user: "owner", body: { target: { type: "build", id: "BBBBBBBBBBBBBBBBBBBBBB" }, access: "copy", expiresIn: 7 } })).json()) as {
      code: string;
      expiresAt: number;
    };
    expect(link.expiresAt).toBeGreaterThan(Date.now());
    const snapshot = await (await call(`/api/s/${link.code}`, { origin: null })).json();
    expect(snapshot).toMatchObject({ targetType: "build", access: "copy" });
    expect((await call(`/api/s/${link.code}/copy`, { method: "POST", body: {} })).status).toBe(401);
    const copy = (await (await call(`/api/s/${link.code}/copy`, { method: "POST", user: "visitor", body: {} })).json()) as { url: string };
    expect(copy.url).toMatch(/^\/gun-builder\/[A-Za-z0-9_-]{22}$/);
  });

  it("limits each item to 5 active links", async () => {
    const id = await ownBuild("user_owner");
    for (let index = 0; index < 5; index += 1) await createLink(durable.env, "user_owner", { target: { type: "build", id }, access: "view" }, new Request(ORIGIN));
    await expect(createLink(durable.env, "user_owner", { target: { type: "build", id }, access: "view" }, new Request(ORIGIN))).rejects.toThrow(/at most 5/);
  });
});

describe("sign-in intents", () => {
  async function startIntent(code: string, origin: string | null = ORIGIN) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (origin) headers.origin = origin;
    return signInWithIntent(new Request(`${ORIGIN}/auth/sign-in`, { method: "POST", headers, body: JSON.stringify({ intent: "copy", code }) }));
  }

  it("takes an intent only from this site's pages, and only for a valid code", async () => {
    const code = await createLinkCode(linkKeys());
    expect((await startIntent(code, "https://evil.example")).status).toBe(403);
    expect((await startIntent("1notavalidcodeatall00")).status).toBe(400);
    const ok = await startIntent(code);
    expect(ok.status).toBe(200);
    const { url } = (await ok.json()) as { url: string };
    // The code is never in the sign-in URL.
    expect(url).not.toContain(code);
  });

  it("completes the copy after sign-in and lands on the new build, or back on the link with the reason", async () => {
    const id = await ownBuild("user_owner");
    const link = await createLink(durable.env, "user_owner", { target: { type: "build", id }, access: "copy" }, new Request(ORIGIN));
    const finish = async () => {
      const started = await startIntent(link.code);
      const state = new URL(((await started.json()) as { url: string }).url).searchParams.get("state")!;
      const cookie = /eft_auth_state=([^;]+)/.exec(started.headers.get("set-cookie") ?? "")![1];
      return authCallback(new Request(`${ORIGIN}/auth/callback?state=${state}&dev_user=visitor`, { headers: { cookie: `${STATE_COOKIE}=${cookie}` } }));
    };
    const landed = await finish();
    expect(landed.headers.get("location")).toMatch(/^http:\/\/localhost:3000\/gun-builder\/[A-Za-z0-9_-]{22}\?saved=1$/);
    expect(landed.headers.get("set-cookie")).toContain(`${STATE_COOKIE}=;`);

    await userObject(durable.env, "user_owner").setAllowCopy("build", id, false);
    const refused = await finish();
    expect(refused.headers.get("location")).toBe(`${ORIGIN}/s/${link.code}?error=forbidden`);
  });
});
