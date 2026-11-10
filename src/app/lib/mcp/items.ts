import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGroupItems, getItemDetail, getItemUses } from "@/app/lib/api/tarkov-server";
import type { CatalogItem } from "@/app/lib/cache/types";
import { filterCatalog } from "@/app/lib/search/filter-catalog";
import { resolveItemReference, type ResolvedItem } from "@/app/lib/search/item-reference";
import { formatGroupPriceList } from "@/app/lib/item-groups/format";
import { MAX_GROUP_NAME_LENGTH } from "@/app/lib/item-groups/limits";
import { InputError, type ToolContext } from "./context";
import { neededSummary, priceSummary, projectDetail } from "./item-projection";
import { getItemOutput, getItemPricesOutput, searchItemsOutput } from "./output-schemas";
import { toolDefiner } from "./define-tool";
import { gameModeSchema } from "./schemas";
import { itemUrl, loadCatalogIndex } from "./sources";

const MAX_PRICE_ITEMS = 100;
const MAX_SEARCH_PAGE_END = 101;
const ITEM_REFERENCE_MAX = 500;

function describeMatch(reference: string, resolved: ResolvedItem) {
  if (resolved.matchedBy !== "search") return undefined;
  return {
    note: `No exact match for "${reference}"; using the best search match.`,
    otherMatches: resolved.alternatives,
  };
}

const itemListEntry = z.union([
  z.string().min(1).max(ITEM_REFERENCE_MAX),
  z.object({
    item: z.string().min(1).max(ITEM_REFERENCE_MAX),
    count: z.number().int().min(1).max(100_000).default(1),
  }),
]);

export function registerItemTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "search_items",
    {
      outputSchema: searchItemsOutput,
      inputSchema: {
        query: z.string().min(1).max(200).describe("Search text, for example \"salewa\" or \"LEDX\"."),
        gameMode: gameModeSchema,
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).max(MAX_SEARCH_PAGE_END - 20).default(0).describe("Skip this many results; use nextOffset."),
      },
    },
    async ({ query, gameMode, limit, offset }, { read }) => {
      const index = await loadCatalogIndex(read, gameMode);
      // One extra result shows whether another page exists.
      const matches = filterCatalog(index.items, query, [], offset + limit + 1, MAX_SEARCH_PAGE_END);
      const results = matches.slice(offset, offset + limit);
      return {
        query,
        gameMode,
        nextOffset: matches.length > offset + limit ? offset + limit : null,
        results: results.map((item) => ({
          id: item.id,
          name: item.name,
          shortName: item.shortName,
          slug: item.normalizedName,
          url: itemUrl(context, item),
        })),
      };
    }
  );

  define(
    "get_item",
    {
      outputSchema: getItemOutput,
      inputSchema: {
        item: z
          .string()
          .min(1)
          .max(ITEM_REFERENCE_MAX)
          .describe("Item id, slug, exact name, short name, item page URL, or search text."),
        gameMode: gameModeSchema,
        include: z
          .array(z.enum(["tasks", "hideout", "barters", "crafts"]))
          .default(["tasks", "hideout"])
          .describe('Relations to list in full; the rest are returned as counts. Add "barters" or "crafts" to list them.'),
      },
    },
    async ({ item, gameMode, include }, { read }) => {
      const index = await loadCatalogIndex(read, gameMode);
      const resolved = resolveItemReference(index, item);
      if (!resolved) throw new InputError(`No item matches "${item}". Try search_items.`);
      const slug = resolved.item.normalizedName;
      const detail = await read(() =>
        getItemDetail(gameMode, slug ? { slug } : { name: resolved.item.name })
      );
      if (!detail) throw new InputError(`No details are available for ${resolved.item.name}.`);
      return {
        gameMode,
        ...describeMatch(item, resolved),
        ...projectDetail(detail, context, new Set(include)),
      };
    }
  );

  define(
    "get_item_prices",
    {
      outputSchema: getItemPricesOutput,
      inputSchema: {
        items: z
          .array(itemListEntry)
          .min(1)
          .max(MAX_PRICE_ITEMS)
          .describe('Item names, ids, slugs, or {"item": "...", "count": n} entries.'),
        gameMode: gameModeSchema,
        sortBy: z
          .enum(["input", "price", "perSlot", "name"])
          .default("input")
          .describe("price and perSlot sort highest first."),
        groupName: z
          .string()
          .max(MAX_GROUP_NAME_LENGTH)
          .default("Item group")
          .describe("Title used for the Discord price list."),
        includeDiscordText: z.boolean().default(false),
      },
    },
    async ({ items, gameMode, sortBy, groupName, includeDiscordText }, { read }) => {
      const index = await loadCatalogIndex(read, gameMode);
      const unresolved: string[] = [];
      const fuzzy: { input: string; matched: string }[] = [];
      const requested = new Map<string, { item: CatalogItem; count: number }>();
      for (const entry of items) {
        const reference = typeof entry === "string" ? entry : entry.item;
        const count = typeof entry === "string" ? 1 : entry.count;
        const resolved = resolveItemReference(index, reference);
        if (!resolved) {
          unresolved.push(reference);
          continue;
        }
        if (resolved.matchedBy === "search") fuzzy.push({ input: reference, matched: resolved.item.name });
        const existing = requested.get(resolved.item.name);
        requested.set(resolved.item.name, {
          item: resolved.item,
          count: (existing?.count ?? 0) + count,
        });
      }
      const names = Array.from(requested.keys());
      const [priced, uses] = await read(() =>
        Promise.all([getGroupItems(gameMode, names), getItemUses(gameMode, names)])
      );
      const byName = new Map(priced.map((item) => [item.name, item]));
      let rows = Array.from(requested.values()).map(({ item, count }) => {
        const data = byName.get(item.name);
        const summary = data ? priceSummary(data) : null;
        const itemUses = uses.get(item.name);
        const unit = summary?.bestSell?.priceRUB ?? null;
        return {
          name: item.name,
          shortName: item.shortName,
          url: itemUrl(context, item),
          count,
          size: data ? `${data.width}x${data.height}` : null,
          ...summary,
          totalRUB: unit === null ? null : unit * count,
          needed: itemUses ? neededSummary(itemUses) : null,
          usedInTasks: data ? Array.from(new Set(data.usedInTasks.map((task) => task.name))) : [],
        };
      });
      if (sortBy === "price") {
        rows = rows.toSorted((a, b) => (b.bestSell?.priceRUB ?? -1) - (a.bestSell?.priceRUB ?? -1));
      } else if (sortBy === "perSlot") {
        rows = rows.toSorted((a, b) => (b.bestSell?.perSlotRUB ?? -1) - (a.bestSell?.perSlotRUB ?? -1));
      } else if (sortBy === "name") {
        rows = rows.toSorted((a, b) => a.name.localeCompare(b.name));
      }
      const totalRUB = rows.reduce((total, row) => total + (row.totalRUB ?? 0), 0);
      return {
        gameMode,
        totalRUB,
        itemCount: rows.reduce((total, row) => total + row.count, 0),
        noBuyer: rows.filter((row) => !row.bestSell).map((row) => row.name),
        rows,
        ...(fuzzy.length ? { fuzzyMatches: fuzzy } : {}),
        ...(unresolved.length ? { unresolved } : {}),
        ...(includeDiscordText
          ? {
              discordText: formatGroupPriceList(
                groupName,
                rows.map((row) => ({
                  name: row.count > 1 ? `${row.count}× ${row.name}` : row.name,
                  price: row.totalRUB,
                  vendor: row.bestSell ? (row.bestSell.afterFleaFee ? "Flea" : row.bestSell.vendor) : null,
                })),
                totalRUB
              ),
            }
          : {}),
      };
    }
  );
}
