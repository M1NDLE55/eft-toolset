import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tarkovDataStatus } from "@/app/lib/api/tarkov-server";
import { snapshotBuiltAt } from "@/app/lib/api/tarkov-snapshot";
import type { ToolContext } from "./context";
import { toolDefiner } from "./define-tool";
import { getDataStatusOutput } from "./output-schemas";

export function registerStatusTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "get_data_status",
    {
      // Reads only what this instance holds: no requests to tarkov.dev.
      annotations: { openWorldHint: false },
      outputSchema: getDataStatusOutput,
      inputSchema: {
        gameMode: z.enum(["regular", "pve"]).optional().describe("Only this game mode; omit for both."),
      },
    },
    async ({ gameMode }) => {
      const datasets = tarkovDataStatus(gameMode ? [gameMode] : undefined);
      const builtAt = await snapshotBuiltAt();
      return {
        status: datasets.some((dataset) => dataset.state === "failing") ? ("degraded" as const) : ("ok" as const),
        deploymentSnapshotAsOf: builtAt === null ? null : new Date(builtAt).toISOString(),
        freshnessTargets: { prices: "5 minutes", tasksAndMaps: "30 minutes", catalog: "2 hours (changes with game patches)" },
        datasets: datasets.map((dataset) => ({ ...dataset })),
      };
    }
  );
}
