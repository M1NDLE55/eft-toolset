import { z } from "zod";
import type { CallToolResult, ListToolsResult, McpServer, Tool, ToolAnnotations } from "@modelcontextprotocol/server";

/** What tools/list publishes for one tool, and what tools/call runs; the zod schemas validate every call. */
export interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodObject;
  annotations: ToolAnnotations;
  /** Runs the tool with validated arguments; never throws (runTool turns failures into tool errors). */
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

type JsonSchema = { [key: string]: unknown };

// Limits that only guard against abuse: the server still enforces them, and its errors say
// what was wrong, so publishing them would only cost every client context.
const ABUSE_LIMIT = { maxItems: 50, maximum: 10_000 };

/**
 * The published input schema: the JSON Schema the SDK would publish, without string length
 * limits and abuse-sized maximums, which the server keeps enforcing. Dropping them only
 * widens the schema, so everything it allowed before it still allows.
 */
export function publishedInputSchema(schema: z.ZodObject): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as JsonSchema;
  delete json.$schema;
  return stripLimits(json) as JsonSchema;
}

function stripLimits(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripLimits);
  if (!node || typeof node !== "object") return node;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "maxLength" || key === "minLength") continue;
    if (key === "additionalProperties" && isEmptyObject(value)) continue;
    if (key === "maxItems" && typeof value === "number" && value >= ABUSE_LIMIT.maxItems) continue;
    if (key === "maximum" && typeof value === "number" && value >= ABUSE_LIMIT.maximum) continue;
    // A record's key schema is only {"type": "string"} once its length limit is gone.
    if (key === "propertyNames") continue;
    out[key] = stripLimits(value);
  }
  return out;
}

/**
 * The published output schema: the result's top-level fields with their types, which fields
 * are always present, and their descriptions. Nested objects and array entries are published
 * as plain objects, since every result carries its own field names; the full zod schema still
 * validates each result on the server. Leaving out nested properties only widens the schema,
 * so every result that matches the full schema matches the published one.
 */
export function publishedOutputSchema(schema: z.ZodObject): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as JsonSchema;
  delete json.$schema;
  const published = topLevel(json, 0) as JsonSchema;
  // Every data result's optional freshness fields: the server instructions describe them once.
  const properties = published.properties as JsonSchema | undefined;
  for (const field of SHARED_RESULT_FIELDS) delete properties?.[field];
  return published;
}

const SHARED_RESULT_FIELDS = ["dataAsOf", "dataNotice", "priceSource"];

function topLevel(node: unknown, depth: number): unknown {
  if (Array.isArray(node)) return node.map((entry) => topLevel(entry, depth));
  if (!node || typeof node !== "object") return node;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    // Objects are open; {} is the same as leaving additionalProperties out.
    if (key === "additionalProperties" && isEmptyObject(value)) continue;
    if (key === "properties") {
      if (depth > 0) continue;
      out[key] = Object.fromEntries(
        Object.entries(value as JsonSchema).map(([name, property]) => [name, topLevel(property, depth + 1)])
      );
    } else if (key === "required") {
      if (depth === 0) out[key] = value;
    } else if (key === "anyOf") {
      // Branches that differed only in their properties are now the same; keep one of each.
      const branches = (value as unknown[]).map((branch) => topLevel(branch, depth));
      const distinct = [...new Map(branches.map((branch) => [JSON.stringify(branch), branch])).values()];
      if (distinct.length === 1) Object.assign(out, distinct[0]);
      else out[key] = distinct;
    } else if (key === "items") {
      const items = topLevel(value, depth);
      // An array of plain objects says no more than an array.
      if (JSON.stringify(items) !== '{"type":"object"}') out[key] = items;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isEmptyObject(value: unknown) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

// MCP defaults an omitted openWorldHint to true.
export function publishedAnnotations(annotations: ToolAnnotations): ToolAnnotations {
  if (annotations.openWorldHint !== true) return annotations;
  const { openWorldHint, ...rest } = annotations;
  return rest;
}

const listings = new WeakMap<McpServer, ListedTool[]>();
const published = new Map<string, Tool>();

/** Records a registered tool for the compact tools/list. */
export function listTool(server: McpServer, tool: ListedTool) {
  const tools = listings.get(server) ?? [];
  tools.push(tool);
  listings.set(server, tools);
}

function publish(tool: ListedTool): Tool {
  // Schemas never change at runtime, so each tool is converted once per process.
  let entry = published.get(tool.name);
  if (!entry) {
    entry = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: publishedInputSchema(tool.inputSchema) as Tool["inputSchema"],
      outputSchema: publishedOutputSchema(tool.outputSchema) as Tool["outputSchema"],
      annotations: publishedAnnotations(tool.annotations),
    };
    published.set(tool.name, entry);
  }
  return entry;
}

/** "Invalid input: expected string, received number at item": one line per problem, as clients have always seen them. */
function describeIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      if (!issue.path.length) return issue.message;
      const path = issue.path.reduce<string>(
        (at, segment, index) => (index === 0 ? String(segment) : typeof segment === "number" ? `${at}[${segment}]` : `${at}.${String(segment)}`),
        ""
      );
      return `${issue.message} at ${path}`;
    })
    .join("\n");
}

/** A failed call, as a tool error the model can read. The code prefix is the one these results have always carried. */
function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: `MCP error -32602: ${message}` }], isError: true };
}

/**
 * Answers tools/call. An unknown tool and arguments that don't fit its schema come back as tool
 * errors (isError) naming the problem, as they always have, rather than as protocol errors; a
 * successful result is checked against the tool's output schema.
 */
function serveToolCalls(server: McpServer, tools: ReadonlyMap<string, ListedTool>) {
  server.server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.get(name);
    if (!tool) return toolError(`Tool ${name} not found`);
    const input = await tool.inputSchema.safeParseAsync(args ?? {});
    if (!input.success) return toolError(`Input validation error: Invalid arguments for tool ${name}: ${describeIssues(input.error)}`);
    const result = await tool.run(input.data);
    if (!result.isError) {
      if (result.structuredContent === undefined) return toolError(`Output validation error: Tool ${name} has an output schema but no structured content was provided`);
      const output = await tool.outputSchema.safeParseAsync(result.structuredContent);
      if (!output.success) return toolError(`Output validation error: Invalid structured content for tool ${name}: ${describeIssues(output.error)}`);
    }
    // Every output schema has an object root, so no advertised schema needs passing for wrapping.
    return server.server.projectCallToolResult(result, undefined);
  });
}

/**
 * Answers tools/list with the compact schemas above instead of the SDK's full conversion, and
 * tools/call with serveToolCalls. Call it after registering every tool: the SDK installs its own
 * handlers on the first registration, and these replace them.
 */
export function serveCompactToolList(server: McpServer, securitySchemes?: readonly object[]) {
  serveToolCalls(server, new Map((listings.get(server) ?? []).map((tool) => [tool.name, tool])));
  const tools = (listings.get(server) ?? [])
    .map(publish)
    .map((tool) => (securitySchemes ? { ...tool, securitySchemes, _meta: { ...tool._meta, securitySchemes } } : tool)) as unknown as ListToolsResult["tools"];
  server.server.setRequestHandler("tools/list", () => ({ tools }));
}
