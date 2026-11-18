import { groupWikiSections, type WikiPageSection } from "./page-sections";
import { findItemWikiPage, wikiSnapshotDate } from "./snapshot";

export type ItemWikiSection = WikiPageSection;

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

/** The item's wiki page shaped for the item page, or null when there is none or it can't be read. */
export async function readItemWiki(id: string): Promise<ItemWiki | null> {
  try {
    const page = await findItemWikiPage(id);
    if (!page) return null;
    const sections = groupWikiSections(page.sections, LEFT_OUT);
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
      whereToFind: sections.filter((section) => WHERE.test(section.heading)),
      notes: sections.filter((section) => !WHERE.test(section.heading)),
    };
  } catch (error) {
    console.warn("Item wiki page could not be read:", error instanceof Error ? error.message : error);
    return null;
  }
}
