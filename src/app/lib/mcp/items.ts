import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGroupItems, getItemDetail, getItemFacets, type ItemFacets } from "@/app/lib/api/tarkov-server";
import type { CatalogItem } from "@/app/lib/cache/types";
import { listCatalog, searchCatalog, suggestNames } from "@/app/lib/search/filter-catalog";
import { matchItemReference, type ItemMatch, type MatchKind } from "@/app/lib/search/item-reference";
import { describeInexact, isInexact, unmatchedMessage } from "./item-match";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { formatGroupPriceList } from "@/app/lib/item-groups/format";
import { MAX_GROUP_NAME_LENGTH } from "@/app/lib/item-groups/limits";
import { InputError, type ToolContext } from "./context";
import { priceSummary, projectDetail } from "./item-projection";
import { getItemOutput, getItemPricesOutput, searchItemsOutput } from "./output-schemas";
import { toolDefiner } from "./define-tool";
import { gameModeSchema, offsetSchema } from "./schemas";
import { itemUrl, loadCatalogIndex } from "./sources";

const MAX_PRICE_ITEMS = 100;
const MAX_SEARCH_LIMIT = 100;
const ITEM_REFERENCE_MAX = 500;

function describeMatch(reference: string, match: Extract<ItemMatch, { status: "found" }>) {
  if (!isInexact(match)) return undefined;
  return {
    matchedBy: match.matchedBy,
    note: describeInexact(reference, match),
    ...(match.alternatives?.length ? { otherMatches: match.alternatives } : {}),
  };
}

const compactKey = (value: string) => normalizeText(value).replace(/[^\p{L}\p{N}]/gu, "");

/** Keeps items in a handbook category, item category, or tarkov.dev type, and of a caliber. */
function facetFilter(facets: ItemFacets, category: string | undefined, caliber: string | undefined) {
  let categoryKey: string | undefined;
  if (category) {
    const wanted = compactKey(category);
    const keys = new Set<string>();
    for (const facet of facets.byId.values()) {
      for (const key of [...facet.categories, ...facet.types]) keys.add(compactKey(key));
    }
    categoryKey = [wanted, `${wanted}s`, wanted.replace(/e?s$/, "")].find((key) => keys.has(key));
    if (!categoryKey && wanted.length >= 4) {
      // A unique prefix: "stim" or "stims" for "Stimulant".
      const stem = wanted.replace(/s$/, "");
      const prefixed = [...keys].filter((key) => key.startsWith(stem));
      if (prefixed.length === 1) categoryKey = prefixed[0];
    }
    if (!categoryKey) {
      const names = [...facets.categoryNames, ...facets.itemCategoryNames].map((name) => ({
        id: name,
        name,
        shortName: null,
        normalizedName: null,
        gridImageLink: null,
      }));
      const close = suggestNames(names, category, 5);
      throw new InputError(
        `Unknown category "${category}". ${close.length ? `Did you mean: ${close.join("; ")}? ` : ""}Handbook categories: ${facets.categoryNames.join(", ")}.`
      );
    }
  }
  const caliberKey = caliber ? compactKey(caliber) : undefined;
  return (item: CatalogItem) => {
    const facet = facets.byId.get(item.id);
    if (!facet) return false;
    if (categoryKey && ![...facet.categories, ...facet.types].some((key) => compactKey(key) === categoryKey)) return false;
    if (caliberKey && !compactKey(facet.caliber?.replace(/^Caliber/, "") ?? "").includes(caliberKey)) return false;
    return true;
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
        query: z.string().min(1).max(200).optional().describe('Search text, for example "salewa" or "LEDX". Tolerates typos.'),
        category: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Handbook category or item type, for example "Injectors", "Keys", "Mechanical keys", "Rounds", "Barter items".'),
        caliber: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe('Caliber, for example "5.56x45" or "12g". Matches ammo and weapons; add category "Rounds" for ammo only.'),
        gameMode: gameModeSchema,
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(10),
        offset: offsetSchema,
        compact: z.boolean().default(false).describe("Return only name and shortName per result, for long lists."),
      },
    },
    async ({ query, category, caliber, gameMode, limit, offset, compact }, { read }) => {
      if (!query?.trim() && !category && !caliber) throw new InputError("Give a query, a category, or a caliber.");
      const index = await loadCatalogIndex(read, gameMode);
      const filter =
        category || caliber ? facetFilter(await read(() => getItemFacets(gameMode)), category, caliber) : undefined;
      // One extra result shows whether another page exists.
      const found = query?.trim()
        ? searchCatalog(index.items, query, { filter, fuzzy: true, limit: offset + limit + 1 })
        : listCatalog(index.items, filter!, offset + limit + 1);
      const results = found.matches.slice(offset, offset + limit).map(({ item }) => item);
      const suggestions = found.total === 0 && query ? suggestNames(index.items, query) : [];
      return {
        ...(query ? { query } : {}),
        gameMode,
        total: found.total,
        nextOffset: found.total > offset + limit ? offset + limit : null,
        ...(found.fuzzy ? { fuzzy: true as const } : {}),
        ...(suggestions.length ? { didYouMean: suggestions } : {}),
        results: results.map((item) =>
          compact
            ? { name: item.name, shortName: item.shortName }
            : {
                id: item.id,
                name: item.name,
                shortName: item.shortName,
                slug: item.normalizedName,
                url: itemUrl(context, item),
              }
        ),
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
          .array(z.enum(["tasks", "barters", "crafts"]))
          .default(["tasks"])
          .describe('Relations to list in full; the rest are returned as counts. Add "barters" or "crafts" to list them.'),
      },
    },
    async ({ item, gameMode, include }, { read }) => {
      const index = await loadCatalogIndex(read, gameMode);
      const match = matchItemReference(index, item);
      if (match.status !== "found") throw new InputError(unmatchedMessage(item, match));
      const slug = match.item.normalizedName;
      const detail = await read(() =>
        getItemDetail(gameMode, slug ? { slug } : { name: match.item.name })
      );
      if (!detail) throw new InputError(`No details are available for ${match.item.name}.`);
      return {
        gameMode,
        ...describeMatch(item, match),
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
      const unmatched: { input: string; reason: "ambiguous" | "not found"; candidates: string[] }[] = [];
      const fuzzy: { input: string; matched: string; matchedBy: MatchKind; note: string }[] = [];
      const requested = new Map<string, { item: CatalogItem; count: number; inputs: string[] }>();
      for (const entry of items) {
        const reference = typeof entry === "string" ? entry : entry.item;
        const count = typeof entry === "string" ? 1 : entry.count;
        const match = matchItemReference(index, reference);
        if (match.status !== "found") {
          unresolved.push(reference);
          unmatched.push(
            match.status === "ambiguous"
              ? { input: reference, reason: "ambiguous", candidates: match.candidates }
              : { input: reference, reason: "not found", candidates: match.suggestions }
          );
          continue;
        }
        if (isInexact(match)) {
          fuzzy.push({
            input: reference,
            matched: match.item.name,
            matchedBy: match.matchedBy,
            note: describeInexact(reference, match),
          });
        }
        const existing = requested.get(match.item.name);
        requested.set(match.item.name, {
          item: match.item,
          count: (existing?.count ?? 0) + count,
          inputs: [...(existing?.inputs ?? []), reference],
        });
      }
      const priced = await read(() => getGroupItems(gameMode, Array.from(requested.keys())));
      const byName = new Map(priced.map((item) => [item.name, item]));
      let rows = Array.from(requested.values()).map(({ item, count, inputs }) => {
        const data = byName.get(item.name);
        const summary = data ? priceSummary(data) : null;
        const unit = summary?.bestSell?.priceRUB ?? null;
        return {
          inputs,
          name: item.name,
          shortName: item.shortName,
          url: itemUrl(context, item),
          count,
          size: data ? `${data.width}x${data.height}` : null,
          ...summary,
          totalRUB: unit === null ? null : unit * count,
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
        ...(unresolved.length ? { unresolved, unmatched } : {}),
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
