import { groupWikiSections, type WikiPageSection } from "./page-sections";
import { findWikiPage, parseWikiLink, readImageCredits, wikiSnapshotDate, type WikiPageImage, type WikiPageRecord } from "./snapshot";
import { wikiPageUrl } from "./wiki-url";
import type { QuestWikiImage } from "./wiki-images";

/** A quest image with which of a repeated heading's sections it sits in; the page uses that to place it. */
export type QuestWikiPageImage = QuestWikiImage & Pick<WikiPageImage, "sectionOccurrence" | "subsectionOccurrence">;

/** What the quest page shows from a quest's wiki page. Wiki text is written by anyone: show it as text only. */
export interface QuestWiki {
  title: string;
  url: string;
  lastEdited: string;
  snapshotDate: string;
  /** How to do it: the guide with its spawn, map and faction subsections, builds, notes, initial equipment, failure penalty, trivia. */
  guide: WikiPageSection[];
  /** The trader's briefing and failure lines: flavour text, best collapsed. */
  dialogue: WikiPageSection[];
  /**
   * Map, location and in-raid pictures, with the section they sit in. Only names and hash paths:
   * the browser builds the image URL (wikiImageUrl), so these pages never carry it.
   */
  images: QuestWikiPageImage[];
}

// tarkov.dev serves these (objectives, rewards, requirements), or they hold nothing worth reading.
const LEFT_OUT = new Set([
  "introduction",
  "description",
  "objectives",
  "rewards",
  "requirements",
  "see also",
  "gallery",
]);
const DIALOGUE = /dialogue/i;

async function findQuestPage(wikiLink: string | null, name: string) {
  let title = name;
  if (wikiLink) {
    try {
      title = parseWikiLink(wikiLink)?.title ?? name;
    } catch {
      // A link to another site: look the quest up by name instead.
    }
  }
  const found = await findWikiPage(title);
  // tarkov.dev links some tasks to a page that isn't a quest's (Immunity, the skill).
  return found && found.page.kind === "quest" ? found.page : null;
}

async function questImages(page: WikiPageRecord): Promise<QuestWikiPageImage[]> {
  if (!page.images?.length) return [];
  const credits = (await readImageCredits()).images;
  // A file the wiki no longer has would only show its fallback link to an empty file page.
  return page.images.filter((image) => !credits[image.file]?.missing).map((image) => ({
    file: image.file,
    hashPath: image.hashPath,
    caption: image.caption,
    section: image.section,
    subsection: image.subsection,
    ...(image.sectionOccurrence ? { sectionOccurrence: image.sectionOccurrence } : {}),
    ...(image.subsectionOccurrence ? { subsectionOccurrence: image.subsectionOccurrence } : {}),
    uploader: credits[image.file]?.uploader ?? null,
    filePage: credits[image.file]?.filePage ?? wikiPageUrl(`File:${image.file}`),
  }));
}

/** The quest's wiki page shaped for the quest page, or null when there is none or it can't be read. */
export async function readQuestWiki(quest: { wikiLink: string | null; name: string }): Promise<QuestWiki | null> {
  try {
    const page = await findQuestPage(quest.wikiLink, quest.name);
    if (!page) return null;
    const sections = groupWikiSections(page.sections, LEFT_OUT);
    return {
      title: page.title,
      url: page.url,
      lastEdited: page.lastEdited,
      snapshotDate: await wikiSnapshotDate(),
      guide: sections.filter((section) => !DIALOGUE.test(section.heading)),
      dialogue: sections.filter((section) => DIALOGUE.test(section.heading)),
      images: await questImages(page),
    };
  } catch (error) {
    console.warn("Quest wiki page could not be read:", error instanceof Error ? error.message : error);
    return null;
  }
}
