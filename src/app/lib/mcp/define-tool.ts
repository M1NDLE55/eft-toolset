import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toolInfo, type McpToolName } from "./catalog";
import { runTool, type GameMode, type NoteSubject, type Read, type ToolContext } from "./context";
import { toolResultKey } from "./result-cache";
import { listTool } from "./tool-list";

export type DefineTool = <Args extends z.ZodRawShape, Out extends z.ZodObject>(
  name: McpToolName,
  config: {
    inputSchema: Args;
    outputSchema: Out;
    annotations?: ToolAnnotations;
    /** Reuse results on this instance while the data they were built from is unchanged. */
    cacheResults?: boolean;
  },
  body: (args: z.output<z.ZodObject<Args>>, call: { read: Read; noteSubject: NoteSubject }) => Promise<z.input<Out>>
) => void;

/**
 * Returns a function that registers a catalogued tool: its title and description come from
 * the catalog, it is read-only and idempotent unless its annotations say otherwise, and its
 * body runs through runTool. TypeScript checks the body's result against the tool's output
 * schema, and tools/call (tool-list.ts) checks it again at runtime. Registering with the SDK too
 * keeps its capabilities and bookkeeping; tool-list.ts answers tools/list and tools/call.
 */
export function toolDefiner(server: McpServer, context: ToolContext): DefineTool {
  return (name, config, body) => {
    const inputSchema = z.object(config.inputSchema);
    const handler = (args: z.output<typeof inputSchema>) =>
      runTool(
        context,
        {
          tool: name,
          gameMode: (args as { gameMode?: GameMode }).gameMode,
          cacheKey: config.cacheResults ? toolResultKey(name, context.origin, args) : undefined,
        },
        (read, noteSubject) => body(args, { read, noteSubject })
      );
    const info = toolInfo(name);
    const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true, ...config.annotations };
    server.registerTool(
      name,
      { ...info, inputSchema, outputSchema: config.outputSchema, annotations },
      // The SDK types a tool's result from its output schema, which TypeScript can't resolve for a
      // generic schema. tools/call goes through tool-list.ts, which checks results at runtime.
      handler as never
    );
    listTool(server, {
      name,
      ...info,
      inputSchema,
      outputSchema: config.outputSchema,
      annotations,
      run: (args) => handler(args as z.output<typeof inputSchema>),
    });
  };
}
