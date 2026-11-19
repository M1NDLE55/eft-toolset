// No server imports: the quest page's client components build image URLs from this.
import { WIKI_LICENCE, WIKI_NAME } from "./wiki-url";

/** A picture from a quest's wiki page, with who uploaded it. */
export interface QuestWikiImage {
  /** The file name as the wiki stores it, such as "Delivery_from_the_past_Customs.png". */
  file: string;
  /** The md5 directories the wiki keeps the file under, such as "4/4a". */
  hashPath: string;
  /** Its caption or alt text, as plain text. */
  caption: string | null;
  /** The heading of the section it sits in, such as "Guide". */
  section: string;
  /** The subsection heading, when it sits in one. */
  subsection: string | null;
  /** Who uploaded it, or null when unknown. */
  uploader: string | null;
  /** The file's page on the wiki. */
  filePage: string;
}

export const WIKI_IMAGE_HOST = "https://static.wikia.nocookie.net";
const WIKI_IMAGE_BASE = `${WIKI_IMAGE_HOST}/escapefromtarkov_gamepedia/images`;

/** Where the wiki serves the file. */
export function wikiImageUrl(image: Pick<QuestWikiImage, "file" | "hashPath">): string {
  return `${WIKI_IMAGE_BASE}/${image.hashPath}/${encodeURIComponent(image.file)}`;
}

export const UNKNOWN_UPLOADER = "EFT Wiki contributors";

/** "Image: <file name> by <uploader>, Escape from Tarkov Wiki, CC BY-NC-SA". */
export function imageCredit(image: Pick<QuestWikiImage, "file" | "uploader">): string {
  return `Image: ${image.file.replace(/_/g, " ")} by ${image.uploader ?? UNKNOWN_UPLOADER}, ${WIKI_NAME}, ${WIKI_LICENCE.name}`;
}
