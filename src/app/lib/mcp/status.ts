import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tarkovDataStatus } from "@/app/lib/api/tarkov-server";
import { priceFeedStatus } from "@/app/lib/api/price-feed";
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
      const modes = gameMode ? [gameMode] : undefined;
      const datasets = tarkovDataStatus(modes);
      const feeds = priceFeedStatus(modes);
      const feedOn = feeds.some((feed) => feed.enabled);
      const builtAt = await snapshotBuiltAt();
      const failing = datasets.some((dataset) => dataset.state === "failing") || feeds.some((feed) => feed.state === "failing");
      return {
        status: failing ? ("degraded" as const) : ("ok" as const),
        deploymentSnapshotAsOf: builtAt === null ? null : new Date(builtAt).toISOString(),
        freshnessTargets: {
          prices: feedOn ? "about 2 minutes behind tarkov.dev, which updates every 5 minutes" : "5 minutes",
          tasksAndMaps: "30 minutes",
          catalog: "2 hours (changes with game patches)",
        },
        // With the price feed on, items is only read for what changes with patches, so it isn't refreshed on a timer.
        datasets: datasets.map((dataset) => ({ ...dataset })),
        priceFeed: feeds.map((feed) => ({ ...feed })),
      };
    }
  );
}
