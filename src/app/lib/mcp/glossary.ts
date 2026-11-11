import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GLOSSARY_CATEGORIES,
  landmarkPosition,
  listTerms,
  lookupTerm,
  mapConfigOf,
  positionSource,
  type GlossaryEntry,
} from "@/app/lib/glossary/glossary";
import { itemHref } from "@/app/lib/item-links";
import { resolveMap } from "@/app/lib/raid-planner/resolve";
import type { ToolContext } from "./context";
import { toolDefiner } from "./define-tool";
import { lookupTermOutput } from "./output-schemas";
import { offsetSchema, page } from "./schemas";

const MAX_TERMS = 20;
const LIST_PAGE_SIZE = 40;

export function registerGlossaryTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "lookup_term",
    {
      // The glossary ships with the app, so lookups reach nothing outside it.
      annotations: { openWorldHint: false },
      outputSchema: lookupTermOutput,
      inputSchema: {
        terms: z
          .array(z.string().trim().min(1).max(2_000))
          .max(MAX_TERMS)
          .optional()
          .describe("Terms, or a player's message to find terms in. Omit to list."),
        category: z.enum(GLOSSARY_CATEGORIES).optional(),
        map: z.string().min(1).max(80).optional().describe("Only landmarks on this map."),
        offset: offsetSchema.describe("Use nextOffset."),
      },
    },
    async ({ terms, category, map, offset }) => {
      const mapKey = map ? resolveMap(map).key : undefined;
      const filter = { category, map: mapKey };
      const describe = (entry: GlossaryEntry) => describeEntry(context, entry);
      if (!terms?.length) {
        const listed = listTerms(filter);
        const rows = page(listed, offset, LIST_PAGE_SIZE);
        return { total: listed.length, entries: rows.items.map(describe), nextOffset: rows.nextOffset };
      }
      return {
        results: terms.map((input) => {
          const result = lookupTerm(input, filter);
          return {
            input,
            match: result.match,
            entries: result.entries.map(describe),
            ...(result.match === "mentions" ? { found: result.found } : {}),
            ...(result.match === "none" && result.suggestions.length ? { suggestions: result.suggestions } : {}),
          };
        }),
      };
    }
  );
}

function describeEntry(context: ToolContext, entry: GlossaryEntry) {
  const mapName = mapConfigOf(entry.map)?.name;
  const position = entry.category === "landmark" ? landmarkPosition(entry) : null;
  return {
    term: entry.term,
    category: entry.category,
    meaning: entry.meaning,
    ...(entry.aliases.length ? { aliases: entry.aliases } : {}),
    ...(entry.map ? { map: entry.map, mapName: mapName ?? entry.map } : {}),
    ...(entry.category === "landmark"
      ? {
          place: position
            ? { ...position, confidence: entry.confidence ?? "low", from: positionSource(entry)! }
            : null,
        }
      : {}),
    ...(entry.itemRefs?.length
      ? {
          items: entry.itemRefs.map((item) => ({
            id: item.id,
            name: item.name,
            url: `${context.origin}${itemHref({ name: item.name, normalizedName: item.slug })}`,
          })),
        }
      : {}),
    source: entry.source,
  };
}
