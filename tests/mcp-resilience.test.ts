// @vitest-environment node
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { clearTarkovResourceCache, settleTarkovRefreshes } from "@/app/lib/api/tarkov-server";
import { setTarkovSnapshotDirForTests } from "@/app/lib/api/tarkov-snapshot";
import { createTarkovFixtures } from "./fixtures/tarkov";
import { writeTarkovSnapshot } from "./fixtures/tarkov-snapshot";

// What an assistant sees when tarkov.dev is down or slow: data with dataAsOf and a dataNotice
// whenever any copy exists, and a structured, retryable error only when none does.

let requestId = 0;
let fixtures: Record<string, unknown>;
let upstreamDown: boolean;
let snapshotDir: string | null;

interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, any>;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  requestId += 1;
  const response = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  expect(response.status).toBe(200);
  const result = (await response.json()).result as ToolResult;
  if (!result.isError) expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text!));
  return result;
}

beforeEach(() => {
  clearTarkovResourceCache();
  resetRequestBudgets();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  fixtures = createTarkovFixtures();
  upstreamDown = false;
  snapshotDir = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (upstreamDown) return new Response("bad gateway", { status: 502 });
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    return new Response(JSON.stringify(fixtures[resource]), { status: 200, headers: { ETag: `"${resource}-1"` } });
  });
});

afterEach(async () => {
  upstreamDown = false;
  await settleTarkovRefreshes();
  setTarkovSnapshotDirForTests(null);
  if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
});

describe("MCP tools on a cold instance with tarkov.dev down", () => {
  it("answer search_items, get_item and get_item_prices from the bundled copy, with its age", async () => {
    snapshotDir = await writeTarkovSnapshot(fixtures, 26 * 60 * 60_000);
    upstreamDown = true;
    for (const [name, args] of [
      ["search_items", { query: "rifle" }],
      ["get_item", { item: "Test Rifle" }],
      ["get_item_prices", { items: ["Test Rifle"] }],
    ] as const) {
      const result = await call(name, args);
      expect(result.isError, name).toBeFalsy();
      expect(result.structuredContent!.dataNotice, name).toMatch(/copy bundled with this server from about 26 hours ago/);
      expect(Date.parse(result.structuredContent!.dataAsOf)).toBeLessThanOrEqual(Date.now() - 26 * 60 * 60_000 + 1_000);
    }
  });

  it("return a structured, retryable error with retryAfterSeconds when there is no copy at all", async () => {
    upstreamDown = true;
    const result = await call("get_item", { item: "Test Rifle" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent!.error).toMatchObject({
      code: "upstream_unavailable",
      retryable: true,
      retryAfterSeconds: expect.any(Number),
    });
    const { retryAfterSeconds } = result.structuredContent!.error;
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(10);
    expect(result.content[0].text).toMatch(new RegExp(`Try again in ${retryAfterSeconds} seconds`));
  });

  it("mark input errors as not retryable", async () => {
    const result = await call("get_item", { item: "zzzz-no-such-item-qqqq" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent!.error).toMatchObject({ code: "invalid_input", retryable: false });
  });
});

describe("MCP results with tarkov.dev up", () => {
  it("carry dataAsOf and no dataNotice", async () => {
    const result = await call("get_item", { item: "Test Rifle" });
    expect(result.structuredContent!.dataNotice).toBeUndefined();
    expect(Math.abs(Date.parse(result.structuredContent!.dataAsOf) - Date.now())).toBeLessThan(5_000);
  });

  it("report each dataset's freshness from get_data_status without fetching", async () => {
    const before = await call("get_data_status", { gameMode: "regular" });
    expect(before.structuredContent).toMatchObject({ status: "ok", deploymentSnapshotAsOf: null });
    expect(before.structuredContent!.datasets.every((dataset: { state: string }) => dataset.state === "not loaded")).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await call("get_item", { item: "Test Rifle" });
    const after = await call("get_data_status", { gameMode: "regular" });
    expect(after.structuredContent!.datasets.find((dataset: { dataset: string }) => dataset.dataset === "items")).toMatchObject({
      loaded: true,
      source: "tarkov.dev",
      state: "fresh",
      refreshAfterSeconds: 300,
    });
  });
});
