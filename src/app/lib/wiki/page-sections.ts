import type { WikiSection } from "./wikitext";

/** One section of a wiki page, as plain text: "- " starts a list line, "| " a table row. */
export interface WikiPageSection {
  heading: string;
  /** Subsections of a section, such as each map under "Location". */
  subsections: { heading: string; text: string }[];
  text: string;
}

const MAX_TEXT = 4_000;

function clip(text: string) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text;
}

/**
 * A page's sections with deeper ones folded into their section, without the sections (and
 * subsections) whose lower-cased heading is in `leftOut`, or any left with no text.
 */
export function groupWikiSections(sections: readonly WikiSection[], leftOut: ReadonlySet<string>): WikiPageSection[] {
  const result: WikiPageSection[] = [];
  let parent: { section: WikiPageSection; level: number } | null = null;
  for (const entry of sections) {
    const heading = entry.heading.trim();
    const dropped = leftOut.has(heading.toLowerCase());
    if (parent && entry.level > parent.level) {
      if (entry.text && !dropped) parent.section.subsections.push({ heading, text: clip(entry.text) });
      continue;
    }
    parent = null;
    // The introduction is level 1 and every other section follows it, so only nested sections group.
    const nests = entry.level >= 2;
    if (dropped) {
      // Drop its subsections too.
      if (nests) parent = { section: { heading, subsections: [], text: "" }, level: entry.level };
      continue;
    }
    const section: WikiPageSection = { heading, subsections: [], text: clip(entry.text) };
    if (nests) parent = { section, level: entry.level };
    result.push(section);
  }
  return result.filter((section) => section.text || section.subsections.length > 0);
}
