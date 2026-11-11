import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchWikiPage,
  isPossibleTitle,
  parseWikiLink,
  searchWiki,
  WIKI_LICENCE,
  WIKI_NAME,
  WIKI_ORIGIN,
  type WikiPage,
} from "@/app/lib/wiki/fandom";
import { INTRODUCTION, wikitextToSections, type WikiSection } from "@/app/lib/wiki/wikitext";
import type { ToolContext } from "./context";
import { toolDefiner } from "./define-tool";
import { getWikiPageOutput } from "./output-schemas";

// Read longer pages by section.
export const MAX_WIKI_CONTENT_CHARS = 12_000;
const MAX_SECTIONS = 20;

export function registerWikiTools(server: McpServer, context: ToolContext) {
  const define = toolDefiner(server, context);
  define(
    "get_wiki_page",
    {
      outputSchema: getWikiPageOutput,
      inputSchema: {
        page: z.string().trim().min(1).max(500).describe("A title, a wiki link (such as wikiLink), or search text."),
        sections: z
          .array(z.string().trim().min(1).max(200))
          .max(MAX_SECTIONS)
          .optional()
          .describe("Headings to return, with their subsections. Omit for the whole page."),
      },
    },
    async ({ page, sections }) => {
      const { signal } = context;
      const link = parseWikiLink(page);
      const [title, fragment] = link ? [link.title, link.fragment] : splitFragment(page);

      let wiki = isPossibleTitle(title) ? await fetchWikiPage(title, signal) : null;
      let matchedBy: "title" | "search" = "title";
      if (!wiki) {
        const candidates = await searchWiki(title || page, signal);
        const exact = candidates.filter((candidate) => normalize(candidate.title) === normalize(title));
        if (exact.length === 1) {
          wiki = await fetchWikiPage(exact[0].title, signal);
          matchedBy = "search";
        }
        if (!wiki) {
          return {
            found: false,
            candidates,
            note:
              candidates.length > 0
                ? `No page is titled "${title}". Call again with one of the candidate titles.`
                : `Nothing on the wiki matches "${title}". Try other words.`,
            credit: `Search results from the ${WIKI_NAME} (${WIKI_ORIGIN}), ${WIKI_LICENCE.name} (${WIKI_LICENCE.url}).`,
          };
        }
      }

      const all = wikitextToSections(wiki.wikitext, wiki.title);
      const wanted = sections ?? (fragment ? [fragment] : wiki.redirectFragment ? [wiki.redirectFragment] : undefined);
      const { chosen, missing } = wanted ? selectSections(all, wanted) : { chosen: all.map((_, index) => index), missing: [] };
      const { content, truncatedIn } = assemble(all, chosen);
      const notes: string[] = [];
      if (missing.length > 0) notes.push(`No section matches ${missing.map((name) => `"${name}"`).join(", ")}; see sections.`);
      if (truncatedIn !== null) {
        notes.push(
          `Content was cut at ${MAX_WIKI_CONTENT_CHARS.toLocaleString("en-US")} characters, in "${truncatedIn}". Ask for later sections by heading.`
        );
      }
      return {
        found: true,
        title: wiki.title,
        url: wiki.url,
        lastEdited: wiki.lastEdited,
        revisionId: wiki.revisionId,
        ...(wiki.redirectedFrom ? { redirectedFrom: wiki.redirectedFrom } : {}),
        ...(matchedBy === "search" ? { matchedBy } : {}),
        sections: all.map((section) => ({ heading: section.heading, level: section.level, chars: section.text.length })),
        ...(missing.length > 0 ? { missingSections: missing } : {}),
        content,
        ...(truncatedIn !== null ? { truncated: true } : {}),
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
        credit: credit(wiki),
      };
    }
  );
}

function credit(wiki: WikiPage) {
  return `From "${wiki.title}" on the ${WIKI_NAME} (${wiki.url}) by its contributors (${wiki.url}?action=history), ${WIKI_LICENCE.name} (${WIKI_LICENCE.url}); converted to plain text. Non-commercial use only.`;
}

function splitFragment(text: string): [string, string | undefined] {
  const at = text.indexOf("#");
  if (at < 0) return [text.trim(), undefined];
  return [text.slice(0, at).trim(), text.slice(at + 1).trim() || undefined];
}

function isIntroduction(section: WikiSection) {
  return section.heading === INTRODUCTION && section.level === 1;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function selectSections(all: WikiSection[], wanted: string[]) {
  const picked = new Set<number>();
  const missing: string[] = [];
  const headings = all.map((section) => normalize(section.heading));
  for (const name of wanted) {
    const target = normalize(name);
    const matches = (test: (heading: string) => boolean) =>
      headings.flatMap((heading, index) => (heading && test(heading) ? [index] : []));
    let found = matches((heading) => heading === target);
    if (found.length === 0) found = matches((heading) => heading.includes(target) || target.includes(heading));
    if (found.length === 0 && target.length >= 6) found = matches((heading) => heading.startsWith(target.slice(0, 6)));
    if (!target || found.length === 0 || (found.length > 1 && headings[found[0]] !== target)) {
      missing.push(name);
      continue;
    }
    const start = found[0];
    picked.add(start);
    if (isIntroduction(all[start])) continue;
    for (let index = start + 1; index < all.length && all[index].level > all[start].level; index += 1) picked.add(index);
  }
  return { chosen: [...picked].toSorted((a, b) => a - b), missing };
}

function assemble(all: WikiSection[], chosen: number[]) {
  const blocks = chosen.flatMap((index, position) => {
    const section = all[index];
    const next = all[chosen[position + 1]];
    if (!section.text && !(next && next.level > section.level)) return [];
    if (isIntroduction(section)) return [{ heading: section.heading, text: section.text }];
    const heading = `${"#".repeat(section.level)} ${section.heading}`;
    return [{ heading: section.heading, text: section.text ? `${heading}\n${section.text}` : heading }];
  });
  let content = "";
  for (const block of blocks) {
    const joined = content ? `${content}\n\n${block.text}` : block.text;
    if (joined.length <= MAX_WIKI_CONTENT_CHARS) {
      content = joined;
      continue;
    }
    const cut = joined.lastIndexOf("\n", MAX_WIKI_CONTENT_CHARS);
    content = joined.slice(0, cut > MAX_WIKI_CONTENT_CHARS / 2 ? cut : MAX_WIKI_CONTENT_CHARS).trimEnd();
    return { content, truncatedIn: block.heading };
  }
  return { content, truncatedIn: null };
}
