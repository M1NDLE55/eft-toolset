// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { clearTarkovResourceCache } from "@/app/lib/api/tarkov-server";
import { clearToolResults } from "@/app/lib/mcp/result-cache";
import { createTarkovFixtures } from "./fixtures/tarkov";

let id = 0;

async function call(name: string, args: Record<string, unknown>) {
  id += 1;
  const response = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  const body = await response.json();
  return body.result as { isError?: boolean; structuredContent?: Record<string, unknown> };
}

function logged() {
  return vi
    .mocked(console.info)
    .mock.calls.map(([line]) => JSON.parse(String(line)))
    .filter((entry) => entry.event === "mcp_tool_call")
    .map((entry) => ({ tool: entry.tool, outcome: entry.outcome, cached: entry.cached }));
}

beforeEach(() => {
  clearTarkovResourceCache();
  clearToolResults();
  resetRequestBudgets();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const fixtures = createTarkovFixtures();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const fixture = (fixtures as Record<string, unknown>)[new URL(String(input)).pathname.split("/").pop()!];
    return fixture ? new Response(JSON.stringify(fixture), { status: 200 }) : new Response("missing", { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const optimize = { build: { weapon: "weapon" }, goal: "recoil" };

it("answers a repeated optimiser call from the cache while the data is unchanged", async () => {
  const first = await call("optimize_build", optimize);
  const second = await call("optimize_build", optimize);
  expect(first.isError).toBeFalsy();
  expect(second.structuredContent).toEqual(first.structuredContent);
  // Different arguments are a different result.
  await call("optimize_build", { ...optimize, goal: "ergonomics" });
  expect(logged()).toEqual([
    { tool: "optimize_build", outcome: "ok", cached: false },
    { tool: "optimize_build", outcome: "ok", cached: true },
    { tool: "optimize_build", outcome: "ok", cached: false },
  ]);
});

it("runs the optimiser again once tarkov.dev data changes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await call("modify_build", { build: { weapon: "weapon" }, changes: [{ action: "fill_required" }] });
  // Prices are due after five minutes and must be reloaded after thirty, which replaces the copy.
  vi.setSystemTime(Date.now() + 31 * 60_000);
  await call("modify_build", { build: { weapon: "weapon" }, changes: [{ action: "fill_required" }] });
  expect(logged().map((entry) => entry.cached)).toEqual([false, false]);
});

it("doesn't keep results built from stale data", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Load every dataset the optimiser reads, then let prices fall due while tarkov.dev is down.
  await call("optimize_build", { ...optimize, goal: "ergonomics" });
  vi.setSystemTime(Date.now() + 31 * 60_000);
  vi.mocked(globalThis.fetch).mockImplementation(async () => new Response("down", { status: 503 }));
  const stale = await call("optimize_build", optimize);
  expect(stale.structuredContent?.dataNotice).toBeDefined();
  await call("optimize_build", optimize);
  expect(logged().map((entry) => entry.cached)).toEqual([false, false, false]);
});

it("doesn't cache tools that aren't marked for it", async () => {
  await call("evaluate_build", { build: { weapon: "weapon" } });
  await call("evaluate_build", { build: { weapon: "weapon" } });
  expect(logged().map((entry) => entry.cached)).toEqual([false, false]);
});
