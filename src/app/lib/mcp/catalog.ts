/**
 * The single list of MCP tools: the server registers each tool with the title and
 * description here, the /mcp page renders the summaries, and the server instructions
 * list the tools by group.
 */
export const MCP_PATH = "/api/mcp";

interface McpToolInfo {
  name: string;
  title: string;
  /** Shown to people on the /mcp page. */
  summary: string;
  /** Shown to the model. */
  description: string;
}

interface McpToolGroup {
  tool: string;
  href: string;
  tools: McpToolInfo[];
}

export const MCP_TOOL_GROUPS = [
  {
    tool: "Item scanner",
    href: "/item",
    tools: [
      {
        name: "search_items",
        title: "Search items",
        summary: "Find items by name or short name, or list a category, type, or ammo caliber.",
        description:
          "Item Scanner search. Finds Escape from Tarkov items by name or short name, ranked the way the app's search ranks them (typos are tolerated when nothing matches exactly, flagged fuzzy), or lists every item in a handbook category, item type, or ammo caliber: up to 100 per page with a total, compact for names only. Returns ids, names, and links to each item's page. Use get_item for prices and uses; get_map_details lists a map's keys.",
      },
      {
        name: "get_item",
        title: "Get item",
        summary: "Prices, best place to sell, value per slot, and every task, hideout upgrade, barter, and craft that uses an item.",
        description:
          "Item Scanner. Everything the item page shows for one item: trader and flea prices, the best place to sell it after the flea listing fee, value per inventory slot, flea eligibility, the 48-hour price change, and what needs it: a total for tasks and hideout upgrades with found-in-raid counts, those tasks and upgrades, and counts of the barters and crafts that use it (list those with include). Flea buy and sell prices are the lowest current listing; the flea buy offer also gives the 24-hour average the item page shows. Ambiguous names return the candidates; inexact matches carry matchedBy and a note.",
      },
    ],
  },
  {
    tool: "Item groups",
    href: "/item-groups",
    tools: [
      {
        name: "get_item_prices",
        title: "Price a list of items",
        summary: "Price up to 100 items with counts, totals, value per slot, and a Discord-ready list.",
        description:
          "Item Groups. Prices a watchlist or a haul of loot in one call: the best place to sell each item (flea after its listing fee, or the best trader), value per slot, the cheapest place to buy it (a trader or the lowest current flea listing), how many tasks and hideout upgrades need it (needed), totals, and optionally the same Discord-ready price list the item-groups page copies. Accepts up to 100 items, each with an optional count. Each row lists the inputs it prices; inexact matches are listed in fuzzyMatches, and ambiguous or unknown inputs are left unpriced in unmatched with their candidates.",
      },
    ],
  },
  {
    tool: "Gun builder",
    href: "/gun-builder",
    tools: [
      {
        name: "list_weapons",
        title: "List weapons",
        summary: "List weapons, filtered by name or caliber.",
        description:
          "Gun Builder. Lists weapons the builder supports, optionally filtered by name and caliber, with ids to use in other gun-builder tools.",
      },
      {
        name: "get_weapon",
        title: "Get weapon",
        summary: "Base stats, presets, slots, and default preset stats for a weapon.",
        description:
          "Gun Builder. A weapon's base stats, caliber, fire modes, default ammo, factory presets, and top-level mod slots (with ids and how many parts fit each), plus the stats of its default preset.",
      },
      {
        name: "get_slot_options",
        title: "List parts for a slot",
        summary: "Parts that fit a slot, with stats, prices, and conflicts.",
        description:
          "Gun Builder slot picker. Lists the parts that fit one slot of a build with their ergonomics, recoil modifier, weight, price, trader and loyalty level, magazine capacity, how many slots of their own they have, and whether they conflict with parts already installed. buyableOnly hides parts the player can't buy. Use the returned ids with modify_build.",
      },
      {
        name: "get_ammo_options",
        title: "List ammo for a build",
        summary: "Ammo a build accepts, with ballistics and prices.",
        description:
          "Gun Builder ammo picker. Lists the ammo a build's magazine and chamber accept (or the weapon's, without a magazine) with damage, penetration, armor damage, fragmentation, speed, recoil and accuracy modifiers, and prices. The best rounds are often flea-banned and sold by no trader; buyableOnly hides those.",
      },
      {
        name: "evaluate_build",
        title: "Evaluate build",
        summary: "Stats, missing parts, conflicts, shopping list, and a share link for a build.",
        description:
          "Gun Builder. Computes a build's ergonomics, recoil (including the loaded ammo, if any), weight, and cost the same way the builder does (flea parts at their 24-hour average), and lists its parts, magazine, sights, empty required slots, part conflicts, problems (no magazine, no usable sights, unbuyable parts), and an optional shopping list. Returns a share link that opens the build in the app, where it can be saved.",
      },
      {
        name: "modify_build",
        title: "Modify build",
        summary: "Install or remove parts, fill required slots with the cheapest parts, and set ammo.",
        description:
          "Gun Builder, part by part. Applies changes to a build in order: install a part in a slot (replacing what is there and carrying its attachments over where they fit), remove a part, fill empty required slots with the cheapest compatible parts, or set the ammo. Returns the updated build, its stats, and a new share link.",
      },
      {
        name: "optimize_build",
        title: "Optimise build",
        summary: "Optimise for ergonomics, recoil, or cost, with an optional budget.",
        description:
          "Gun Builder optimiser. Picks parts for the best ergonomics, the lowest recoil, or the lowest cost, optionally within a budget, avoiding part conflicts. It keeps a magazine no smaller than the installed one and replaces sights only with sights of the same kind; it does not choose ammo. By default it may replace installed parts; set keepInstalledParts to only fill empty slots, or slotPath to optimise one slot. Returns the optimised build, what changed, stat changes, and a share link; an unreachable budget returns the cheapest build with minimumCostRUB.",
      },
      {
        name: "compare_builds",
        title: "Compare builds",
        summary: "Compare two builds stat by stat and slot by slot.",
        description:
          "Gun Builder comparison. Compares two builds side by side: each stat with its difference and which build is better, and a slot-by-slot list of parts that differ.",
      },
    ],
  },
  {
    tool: "Raid planner",
    href: "/raid-planner",
    tools: [
      {
        name: "list_maps",
        title: "List maps",
        summary: "Maps the planner supports, with their levels.",
        description: "Raid Planner. Lists the maps the planner supports, with keys, levels, and links to each interactive map.",
      },
      {
        name: "get_map_details",
        title: "Get map details",
        summary: "Extracts, bosses, spawns, areas, locks, hazards, and loot with coordinates and levels.",
        description:
          "Raid Planner map data: player count and raid time, extracts (PMC, scav, shared, with any item they take), transits, bosses (chance, locations, escorts), areas named after key-lock groups, spawn zones grouped with counts, hazards, switches, and stationary weapons, each with game coordinates (metres) and level. Spawn points, key locks, and loot containers are listed on request, filtered and paged. Also returns the layer ids create_raid_plan accepts. tarkov.dev has no landmark names (such as Big Red) and no extract conditions beyond the name, so use coordinates, areas, or locks for those.",
      },
      {
        name: "create_raid_plan",
        title: "Create raid plan",
        summary: "Draw routes, arrows, and notes, using named places, and get a share link.",
        description:
          "Raid Planner. Draws a plan on a map and returns a share link that opens it in the app, where it can be viewed, edited, and saved. A plan has a route of waypoints, pen and arrow drawings, note pins, and the map layers to show. Points can be game coordinates or place names from get_map_details; names ignore case and punctuation and allow small typos. resolvedPlaces shows what each name became: when approximate is true, call the place by its resolved name. Every problem is reported at once; unknown colours and layer ids only warn. Route distance is straight-line and ignores floors.",
      },
      {
        name: "read_raid_plan",
        title: "Read raid plan link",
        summary: "Describe a plan from its share link.",
        description:
          "Raid Planner. Opens a raid plan share link (…/raid-planner/share/…#p=…) and describes it: the map, route waypoints with their nearest named places (and their level, off the ground floor) and straight-line distance, drawings, notes, and enabled layers.",
      },
    ],
  },
  {
    tool: "Backup and restore",
    href: "/data",
    tools: [
      {
        name: "create_import_link",
        title: "Create import link",
        summary: "Bundle item groups, builds, and plans into one import link for the app.",
        description:
          "Bundles item groups, gun builds, and raid plans into an import link that opens the app's Backup & restore page (/data) with them ready to review; Merge adds them to what the user already has. Give the link to the user. Use this to hand over several things at once or to create item groups, which have no share links. itemMatches says which item each item-group input became.",
      },
    ],
  },
] as const satisfies readonly McpToolGroup[];

export type McpToolName = (typeof MCP_TOOL_GROUPS)[number]["tools"][number]["name"];

export const MCP_TOOL_NAMES: McpToolName[] = MCP_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.name));

const TOOLS_BY_NAME = new Map<string, McpToolInfo>(
  MCP_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => [tool.name, tool] as const))
);

/** The title and description to register a tool with. */
export function toolInfo(name: McpToolName): { title: string; description: string } {
  const info = TOOLS_BY_NAME.get(name)!;
  return { title: info.title, description: info.description };
}
