import { findItemWikiPage, wikiSnapshotDate } from "./snapshot";

/** One section of an item's wiki page, as plain text: "- " starts a list line, "| " a table row. */
export interface ItemWikiSection {
  heading: string;
  /** Subsections of a section, such as each map under "Location". */
  subsections: { heading: string; text: string }[];
  text: string;
}

/** What the item page shows from an item's wiki page. Wiki text is written by anyone: show it as text only. */
export interface ItemWiki {
  title: string;
  url: string;
  lastEdited: string;
  snapshotDate: string;
  facts: { label: string; value: string }[];
  /** Where the item or its lock is found: spawns, key and lock locations, what's behind the lock. */
  whereToFind: ItemWikiSection[];
  /** Everything else: notes, trivia, quest rewards, usage. */
  notes: ItemWikiSection[];
}

// tarkov.dev serves these, or they hold nothing worth reading as text.
const LEFT_OUT = new Set([
  "introduction",
  "description",
  "trading",
  "crafting",
  "hideout",
  "gallery",
  "requirements",
  "mods",
  "see also",
]);
const WHERE = /location|spawn|where to find|behind the lock|loot table/i;

const FACTS: [key: string, label: string][] = [
  ["type", "Type"],
  ["usage", "Opens"],
  ["effect", "Effect"],
  ["effects", "Effects"],
  ["use time", "Use time"],
  ["material", "Material"],
  ["armor", "Armour class"],
  ["armor coverage", "Coverage"],
  ["durability", "Durability"],
  ["capacity", "Capacity"],
  ["caliber", "Calibre"],
  ["loot xp", "Loot XP"],
  ["exam xp", "Examine XP"],
];

const MAX_TEXT = 4_000;

function clip(text: string) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text;
}

/** The item's wiki page shaped for the item page, or null when there is none or it can't be read. */
export async function readItemWiki(id: string): Promise<ItemWiki | null> {
  try {
    const page = await findItemWikiPage(id);
    if (!page) return null;
    const whereToFind: ItemWikiSection[] = [];
    const notes: ItemWikiSection[] = [];
    let parent: { section: ItemWikiSection; level: number } | null = null;
    for (const entry of page.sections) {
      const heading = entry.heading.trim();
      if (parent && entry.level > parent.level) {
        if (entry.text) parent.section.subsections.push({ heading, text: clip(entry.text) });
        continue;
      }
      parent = null;
      // The introduction is level 1 and every other section follows it, so only nested sections group.
      const nests = entry.level >= 2;
      if (LEFT_OUT.has(heading.toLowerCase())) {
        // Drop its subsections too.
        if (nests) parent = { section: { heading, subsections: [], text: "" }, level: entry.level };
        continue;
      }
      const section: ItemWikiSection = { heading, subsections: [], text: clip(entry.text) };
      if (nests) parent = { section, level: entry.level };
      (WHERE.test(heading) ? whereToFind : notes).push(section);
    }
    const keep = (section: ItemWikiSection) => section.text || section.subsections.length > 0;
    const facts = FACTS.flatMap(([key, label]) => {
      const value = page.infobox[key]?.trim();
      // Some infobox templates leave empty labels behind ("Buffs:, Removes:,"); skip those values.
      return value && value.length <= 300 && !/:\s*(,|$)/.test(value) ? [{ label, value }] : [];
    });
    return {
      title: page.title,
      url: page.url,
      lastEdited: page.lastEdited,
      snapshotDate: await wikiSnapshotDate(),
      facts,
      whereToFind: whereToFind.filter(keep),
      notes: notes.filter(keep),
    };
  } catch (error) {
    console.warn("Item wiki page could not be read:", error instanceof Error ? error.message : error);
    return null;
  }
}
