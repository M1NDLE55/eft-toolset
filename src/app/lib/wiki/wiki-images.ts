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

const WIKI_IMAGE_BASE = "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images";

/** Where the wiki serves the file. */
export function wikiImageUrl(image: Pick<QuestWikiImage, "file" | "hashPath">): string {
  return `${WIKI_IMAGE_BASE}/${image.hashPath}/${encodeURIComponent(image.file)}`;
}

export const UNKNOWN_UPLOADER = "EFT Wiki contributors";

/** One run of the credit line: plain text, or a link (`license` marks the licence's). */
export interface CreditPart {
  text: string;
  href?: string;
  license?: true;
}

/**
 * "Image: <file name> by <uploader>, Escape from Tarkov Wiki, CC BY-NC-SA", the file name linking its
 * file page and the licence its terms. Joined, the parts' text is the credit as plain text.
 */
export function imageCreditParts(image: Pick<QuestWikiImage, "file" | "uploader" | "filePage">): CreditPart[] {
  return [
    { text: "Image: " },
    { text: image.file.replace(/_/g, " "), href: image.filePage },
    { text: ` by ${image.uploader ?? UNKNOWN_UPLOADER}, ${WIKI_NAME}, ` },
    { text: WIKI_LICENCE.name, href: WIKI_LICENCE.url, license: true },
  ];
}
