import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type Tool, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** What tools/list publishes for one tool; the zod schemas still validate every call. */
export interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodObject;
  annotations: ToolAnnotations;
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
  return topLevel(json, 0) as JsonSchema;
}

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
      annotations: tool.annotations,
    };
    published.set(tool.name, entry);
  }
  return entry;
}

/**
 * Answers tools/list with the compact schemas above instead of the SDK's full conversion.
 * Call it after registering every tool: the SDK installs its own handler on the first
 * registration, and this replaces it.
 */
export function serveCompactToolList(server: McpServer) {
  const tools = (listings.get(server) ?? []).map(publish);
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
}
