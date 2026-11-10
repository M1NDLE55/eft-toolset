import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolInfo, type McpToolName } from "./catalog";
import { runTool, type GameMode, type Read, type ToolContext } from "./context";
import { listTool } from "./tool-list";

export type DefineTool = <Args extends ZodRawShapeCompat, Out extends z.ZodObject>(
  name: McpToolName,
  config: { inputSchema: Args; outputSchema: Out; annotations?: ToolAnnotations },
  body: (args: ShapeOutput<Args>, call: { read: Read }) => Promise<z.input<Out>>
) => void;

/**
 * Returns a function that registers a catalogued tool: its title and description come from
 * the catalog, it is read-only and idempotent unless its annotations say otherwise, and its
 * body runs through runTool. TypeScript checks the body's result against the tool's output
 * schema, and the SDK checks it again at runtime.
 */
export function toolDefiner(server: McpServer, context: ToolContext): DefineTool {
  return (name, config, body) => {
    const handler = (
      args: ShapeOutput<typeof config.inputSchema>,
      _extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) =>
      runTool(context, { tool: name, gameMode: (args as { gameMode?: GameMode }).gameMode }, (read) =>
        body(args, { read })
      );
    const info = toolInfo(name);
    const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true, ...config.annotations };
    server.registerTool(
      name,
      { ...info, inputSchema: config.inputSchema, outputSchema: config.outputSchema, annotations },
      // The SDK's callback type is conditional on the shape, which TypeScript can't resolve
      // for a generic shape; the handler above has the type it resolves to.
      handler as ToolCallback<typeof config.inputSchema>
    );
    listTool(server, {
      name,
      ...info,
      inputSchema: z.object(config.inputSchema as z.ZodRawShape),
      outputSchema: config.outputSchema,
      annotations,
    });
  };
}
