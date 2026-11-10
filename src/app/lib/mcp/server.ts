import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_TOOL_GROUPS } from "./catalog";
import type { ToolContext } from "./context";
import { registerItemTools } from "./items";
import { registerGunBuilderTools } from "./gun-builder";
import { registerRaidPlannerTools } from "./raid-planner";
import { registerImportLinkTools } from "./import-link";

// The MCP interface version: bump the minor for new tools or fields, the major for breaking changes.
const MCP_SERVER_VERSION = "1.2.0";

const TOOL_LIST = MCP_TOOL_GROUPS.map(
  (group) => `- ${group.tool}: ${group.tools.map((tool) => tool.name).join(", ")}.`
).join("\n");

const INSTRUCTIONS = `EFT Toolset: Escape from Tarkov tools built on live tarkov.dev data.

${TOOL_LIST}

- Every data tool takes gameMode: "regular" (PVP, the default) or "pve". Prices and availability differ between them, so ask or use the mode the user plays.
- Prices are in roubles. In get_item and get_item_prices, flea buy and sell prices are the lowest current listing (it can sell out quickly), and each offer's basis says what its price is. The flea buy offer also carries avg24hRUB, the 24-hour average the item page shows. The best sell price subtracts the flea listing fee.
- Gun-builder flea prices (fleaPriceRUB, and the part prices, costs, and shopping lists built from them) are the 24-hour average, so current listings can be cheaper.
- Gun builder: start with list_weapons or get_weapon. Builds are passed as {"shareLink": ...} or {"weapon": ..., "preset"?: ..., "parts"?: [{"slotPath", "item"}]}; a result's parts (slotPath and itemId) can be passed back as parts to restate a build. Every build result includes a shareLink: pass it to the next build tool to keep working on the same build, and give it to the user so they can open and save the build in the app.
- Raid planner: coordinates are game metres (x, z). Route points and notes can name places such as extracts instead of coordinates. create_raid_plan returns a share link that opens the plan in the app.
- Item names: a short name several unrelated items share (such as "red") is not guessed; the tool returns the candidates, so call again with the full name. Check fuzzyMatches and note fields for typo and search matches.
- create_import_link bundles item groups, builds, and plans into one import link that adds them to the user's app data.
- List results with a nextOffset have more: pass it as offset to get the next page.
- If a result has a dataNotice, tarkov.dev was unreachable and the data is cached; mention it when quoting prices.`;

export function createEftMcpServer(context: ToolContext) {
  const server = new McpServer(
    {
      name: "eft-toolset",
      title: "EFT Toolset",
      version: MCP_SERVER_VERSION,
      websiteUrl: context.origin,
    },
    { instructions: INSTRUCTIONS }
  );
  registerItemTools(server, context);
  registerGunBuilderTools(server, context);
  registerRaidPlannerTools(server, context);
  registerImportLinkTools(server, context);
  registerPrompts(server);
  return server;
}

const gameModeArg = z.enum(["regular", "pve"]).optional().describe("regular (PVP) or pve.");

function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "plan_raid",
    {
      title: "Plan a raid",
      description: "Plan a route on a map and get a share link to open it in the raid planner.",
      argsSchema: {
        map: z.string().describe("Map name, for example Customs."),
        goal: z.string().optional().describe("What the raid is for, such as a quest, loot, or a boss."),
        gameMode: gameModeArg,
      },
    },
    ({ map, goal, gameMode }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Plan an Escape from Tarkov raid on ${map}${goal ? ` for: ${goal}` : ""}${gameMode ? ` (${gameMode} mode)` : ""}. Use get_map_details to find spawns, extracts, locks, and hazards, then create_raid_plan with a route, arrows, and notes explaining each step. Finish with the share link and the route distance.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "build_weapon",
    {
      title: "Build a weapon",
      description: "Build a weapon for a goal and budget and get a share link to open it in the gun builder.",
      argsSchema: {
        weapon: z.string().describe("Weapon name, for example M4A1."),
        goal: z.string().optional().describe("ergonomics, recoil, or cost."),
        budgetRUB: z.string().optional().describe("Maximum cost in roubles."),
        gameMode: gameModeArg,
      },
    },
    ({ weapon, goal, budgetRUB, gameMode }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Build the ${weapon} in Escape from Tarkov${goal ? ` optimised for ${goal}` : ""}${budgetRUB ? ` for at most ${budgetRUB} roubles` : ""}${gameMode ? ` (${gameMode} mode)` : ""}. Use get_weapon, then optimize_build starting from the default preset, check get_ammo_options for good ammo and set it with modify_build, and report the stats, the parts, the total cost, and the share link.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "price_loot",
    {
      title: "Price my loot",
      description: "Price a list of items and say where to sell each one.",
      argsSchema: {
        items: z.string().describe("Items, one per line or comma-separated, optionally with counts."),
        gameMode: gameModeArg,
      },
    },
    ({ items, gameMode }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Price this Escape from Tarkov loot${gameMode ? ` in ${gameMode} mode` : ""} with get_item_prices, sorted by value per slot. Say where to sell each item, flag anything worth keeping for tasks, and give the total.\n\n${items}`,
          },
        },
      ],
    })
  );
}
