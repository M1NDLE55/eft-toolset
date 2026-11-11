// @vitest-environment node
import { expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";

// Every client loads tools/list into its context before the user says anything, so its size
// is a cost every conversation pays. Raise these only for a new tool or a field a caller
// can't do without, and look for something to trim first.
const TOOL_LIST_BUDGET_BYTES = 42_000;
const TOOL_BUDGET_BYTES = 4_500;

async function listTools() {
  const response = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  const text = await response.text();
  return { bytes: new TextEncoder().encode(text).length, tools: JSON.parse(text).result.tools as Record<string, unknown>[] };
}

it("keeps tools/list within its size budget", async () => {
  const { bytes, tools } = await listTools();
  const sizes = Object.fromEntries(tools.map((tool) => [tool.name, JSON.stringify(tool).length]));
  expect(bytes, JSON.stringify(sizes)).toBeLessThanOrEqual(TOOL_LIST_BUDGET_BYTES);
  for (const [name, size] of Object.entries(sizes)) expect(size, name).toBeLessThanOrEqual(TOOL_BUDGET_BYTES);
});

it("publishes self-contained schemas that every client can read", async () => {
  const { tools } = await listTools();
  const json = JSON.stringify(tools);
  // Several clients fail to resolve references in tool schemas, so shapes are inlined.
  expect(json).not.toMatch(/"\$ref"|"\$defs"|"definitions"/);
  for (const tool of tools) {
    const output = tool.outputSchema as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(output.type, `${tool.name}`).toBe("object");
    expect(Object.keys(output.properties).length, `${tool.name}`).toBeGreaterThan(0);
    for (const field of output.required ?? []) expect(output.properties, `${tool.name}.${field}`).toHaveProperty(field);
  }
});
