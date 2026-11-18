import { groupWikiSections, type WikiPageSection } from "./page-sections";
import { findWikiPage, parseWikiLink, wikiSnapshotDate } from "./snapshot";

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
    };
  } catch (error) {
    console.warn("Quest wiki page could not be read:", error instanceof Error ? error.message : error);
    return null;
  }
}
