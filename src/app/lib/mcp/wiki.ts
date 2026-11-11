import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  findLeftOutPage,
  findWikiPage,
  isPossibleTitle,
  normalize,
  parseWikiLink,
  searchWiki,
  wikiSnapshotDate,
  type WikiPageRecord,
} from "@/app/lib/wiki/snapshot";
import { WIKI_LICENCE, WIKI_NAME, WIKI_ORIGIN } from "@/app/lib/wiki/wiki-url";
import { INTRODUCTION, type WikiSection } from "@/app/lib/wiki/wikitext";
import type { ToolContext } from "./context";
import { toolDefiner } from "./define-tool";
import { getWikiPageOutput } from "./output-schemas";

// Read longer pages by section.
export const MAX_WIKI_CONTENT_CHARS = 12_000;
// Pages up to this long come back whole; longer ones as their introduction and section list.
export const WHOLE_PAGE_CHARS = 4_000;
const MAX_SECTIONS = 20;

/** What a left-out page is, and where to look instead. */
const LEFT_OUT: Record<string, { page: string; instead?: string }> = {
  weapon: {
    page: "a weapon or weapon part page",
    instead: "use get_weapon for a gun, or search_items and get_item for a part",
  },
  ammo: { page: "an ammunition page", instead: "use get_ammo_options, or search_items and get_item" },
  item: { page: "an item page", instead: "use search_items and get_item" },
  historical: { page: "about something removed from the game" },
};

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
          .describe("Headings to return, with their subsections. Omit for the summary."),
      },
    },
    async ({ page, sections }) => {
      const link = parseWikiLink(page);
      const [title, fragment] = link ? [link.title, link.fragment] : splitFragment(page);
      const date = (await wikiSnapshotDate()).slice(0, 10);

      const wiki = isPossibleTitle(title) ? await findWikiPage(title) : null;
      if (!wiki) {
        const [candidates, leftOut] = await Promise.all([searchWiki(title || page), findLeftOutPage(title || page)]);
        const about = leftOut ? LEFT_OUT[leftOut.kind] : undefined;
        const exact = leftOut !== null && normalize(leftOut.title) === normalize(title);
        let note: string;
        if (leftOut && about && (exact || candidates.length === 0)) {
          const subject = exact ? `"${leftOut.title}" is` : `"${title}" matches "${leftOut.title}",`;
          note = `${subject} ${about.page}, which the wiki snapshot leaves out${about.instead ? `: ${about.instead}` : ""}.`;
          if (candidates.length > 0) note += " Related wiki pages are in candidates.";
        } else {
          note =
            candidates.length > 0
              ? `No page is titled "${title}". Call again with one of the candidate titles.`
              : `Nothing in the wiki snapshot matches "${title}". Try other words.`;
        }
        return {
          found: false,
          candidates,
          note,
          credit: `Titles from the ${WIKI_NAME} (${WIKI_ORIGIN}), ${WIKI_LICENCE.name} (${WIKI_LICENCE.url}), as of its ${date} database dump.`,
        };
      }

      const all = pageSections(wiki.page);
      const wanted = sections ?? (fragment ? [fragment] : wiki.redirectFragment ? [wiki.redirectFragment] : undefined);
      const whole = all.reduce((total, section) => total + section.text.length, 0) <= WHOLE_PAGE_CHARS;
      const { chosen, missing } = wanted
        ? selectSections(all, wanted)
        : { chosen: whole ? all.map((_, index) => index) : summary(all), missing: [] };
      const { content, truncatedIn } = assemble(all, chosen);
      const notes: string[] = [];
      if (missing.length > 0) notes.push(`No section matches ${missing.map((name) => `"${name}"`).join(", ")}; see sections.`);
      if (!wanted && !whole) notes.push("This is the start of the page. Ask for sections by heading for the rest.");
      if (truncatedIn !== null) {
        notes.push(
          `Content was cut at ${MAX_WIKI_CONTENT_CHARS.toLocaleString("en-US")} characters, in "${truncatedIn}". Ask for later sections by heading.`
        );
      }
      return {
        found: true,
        title: wiki.page.title,
        url: wiki.page.url,
        lastEdited: wiki.page.lastEdited,
        revisionId: wiki.page.revisionId,
        ...(wiki.redirectedFrom ? { redirectedFrom: wiki.redirectedFrom } : {}),
        ...(wiki.matchedBy === "search" ? { matchedBy: wiki.matchedBy } : {}),
        sections: all.map((section) => ({ heading: section.heading, level: section.level, chars: section.text.length })),
        ...(missing.length > 0 ? { missingSections: missing } : {}),
        content,
        ...(truncatedIn !== null ? { truncated: true } : {}),
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
        credit: credit(wiki.page, date),
      };
    }
  );
}

/** The page's sections, with its infobox as the first lines of the introduction. */
function pageSections(page: WikiPageRecord): WikiSection[] {
  const fields = Object.entries(page.infobox).map(([key, value]) => `${key}: ${value}`).join("\n");
  if (!fields) return page.sections;
  const [first, ...rest] = page.sections;
  if (first && isIntroduction(first)) return [{ ...first, text: first.text ? `${fields}\n\n${first.text}` : fields }, ...rest];
  return [{ heading: INTRODUCTION, level: 1, text: fields }, ...page.sections];
}

/** The introduction, or the first section with text (and its subsections) when there is none. */
function summary(all: WikiSection[]) {
  const first = all.findIndex((section) => section.text);
  if (first < 0) return [];
  if (isIntroduction(all[first])) return [first];
  const chosen = [first];
  for (let index = first + 1; index < all.length && all[index].level > all[first].level; index += 1) chosen.push(index);
  return chosen;
}

function credit(page: WikiPageRecord, date: string) {
  return `From "${page.title}" on the ${WIKI_NAME} (${page.url}) by its contributors (${page.url}?action=history), ${WIKI_LICENCE.name} (${WIKI_LICENCE.url}). Adapted: converted to plain text from the wiki's ${date} database dump. Non-commercial use only.`;
}

function splitFragment(text: string): [string, string | undefined] {
  const at = text.indexOf("#");
  if (at < 0) return [text.trim(), undefined];
  return [text.slice(0, at).trim(), text.slice(at + 1).trim() || undefined];
}

function isIntroduction(section: WikiSection) {
  return section.heading === INTRODUCTION && section.level === 1;
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
