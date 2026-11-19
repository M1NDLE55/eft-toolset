// The images on a quest page that help with the quest, for the quest page (see DATA_ARCHITECTURE.md).
import { createHash } from "node:crypto";
import { wikitextToText } from "../src/app/lib/wiki/wikitext.ts";

const HEADING = /^(={1,6})\s*(.+?)\s*\1\s*$/;
const FILE_PREFIX = /^\s*:?\s*(?:file|image)\s*:/i;
const FILE_LINK = /\[\[\s*(?:file|image)\s*:/i;
// What the page's own text leaves out, so headings match the sections it writes.
const HIDDEN = [
  /<!--[\s\S]*?(-->|$)/g,
  /<ref\b[^>]*\/>/gi,
  /<ref\b[^>]*>[\s\S]*?<\/ref>/gi,
  /<(noinclude|includeonly|script|style|math|timeline|templatedata)\b[^>]*>[\s\S]*?<\/\1>/gi,
  /<(span|div)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi,
];
const GALLERY = /<gallery\b[^>]*>([\s\S]*?)<\/gallery>/gi;
const MARK = "\u0000";

// Names of pictures that only illustrate an item, a trader, or the quest itself.
const NOT_A_GUIDE = /icon|portrait|banner|questpicture|_ins\.|main_menu_background|\.svg$/i;
// Sections whose images are reward previews, item rows, or asides. Requirements stay: they show where a quest starts.
const SECTIONS_LEFT_OUT = new Set(["objectives", "rewards", "dialogue", "initial equipment", "trivia"]);
// Thumbnails this small are icons.
const MAX_ICON_WIDTH = 128;
const OPTION =
  /^\s*(?:thumb|thumbnail|frame|framed|frameless|border|left|right|center|centre|none|upright(?:\s*=?\s*[\d.]+)?|baseline|sub|super|top|text-top|middle|bottom|text-bottom|\d*x?\d+\s*px)\s*$/i;
const NAMED = /^\s*(alt|link|class|page|lang|loading|upright)\s*=([\s\S]*)$/i;

/** A file name as MediaWiki stores it: underscores for spaces, runs collapsed, first letter upper case. */
export function normaliseFileName(name) {
  const plain = name
    .replace(FILE_PREFIX, "")
    .replace(/&(amp|quot|apos|#39|#x27);/g, (entity, code) => ({ amp: "&", quot: '"', apos: "'", "#39": "'", "#x27": "'" })[code])
    .replace(/[\s_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** The md5 directories MediaWiki keeps an uploaded file under, such as "4/4a". */
export function hashPath(file) {
  const hash = createHash("md5").update(normaliseFileName(file)).digest("hex");
  return `${hash[0]}/${hash.slice(0, 2)}`;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === "{{" || pair === "[[") {
      depth += 1;
      index += 1;
    } else if ((pair === "}}" || pair === "]]") && depth > 0) {
      depth -= 1;
      index += 1;
    } else if (text[index] === "|" && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function plainText(wikitext, title) {
  return wikitextToText(wikitext, title).replace(/\s+/g, " ").trim();
}

/** A file's options: its caption (the last free text), alt text, link, and widest stated size. */
function readOptions(parts, title) {
  let caption = "";
  let alt = "";
  let link;
  let tabLabel = false;
  let width = null;
  for (const part of parts) {
    const named = NAMED.exec(part);
    if (named) {
      const key = named[1].toLowerCase();
      if (key === "alt") alt = named[2];
      else if (key === "link") link = named[2].trim();
      else if (key === "class") tabLabel ||= /wds-tabs/.test(named[2]);
      continue;
    }
    if (OPTION.test(part)) {
      const size = /(\d*)x?(\d*)\s*px/i.exec(part);
      if (size) {
        const stated = Number(size[1] || size[2]);
        if (stated) width = Math.max(width ?? 0, stated);
      }
      continue;
    }
    if (part.trim()) caption = part;
  }
  const text = plainText(caption, title) || plainText(alt, title);
  return { caption: text || null, link, tabLabel, width };
}

/** Why an image is left out, or null to keep it. */
export function leftOutBecause(image) {
  if (NOT_A_GUIDE.test(image.file)) return "name";
  if (image.tabLabel) return "tab label";
  if (image.width !== null && image.width <= MAX_ICON_WIDTH) return "size";
  // Item pictures link to the item; a guide picture links nowhere or to its own file.
  if (image.link !== undefined && image.link !== "" && !/^\{\{\s*filepath\s*:/i.test(image.link)) return "link";
  if (SECTIONS_LEFT_OUT.has(image.section.toLowerCase())) return "section";
  if (image.subsection && SECTIONS_LEFT_OUT.has(image.subsection.toLowerCase())) return "section";
  return null;
}

/** Every file a page shows, in order, with the section it sits in and why it is left out (null when kept). */
export function surveyImages(wikitext, title) {
  let text = wikitext;
  for (const pattern of HIDDEN) text = text.replace(pattern, "");
  const galleries = [];
  text = text.replace(GALLERY, (_, body) => `${MARK}${galleries.push(body) - 1}${MARK}`);

  const found = [];
  let section = "Introduction";
  let sectionLevel = 1;
  let subsection = null;
  let depth = 0;
  const add = (target, options) => {
    const file = normaliseFileName(target);
    if (!/\.\w+$/.test(file)) return;
    const image = { file, ...readOptions(options, title), section, subsection };
    found.push({ ...image, leftOut: leftOutBecause(image) });
  };
  for (const line of text.split("\n")) {
    const heading = depth === 0 ? HEADING.exec(line) : null;
    if (heading) {
      const name = plainText(heading[2], title) || heading[2];
      const level = heading[1].length;
      // As the quest page groups them: deeper headings fold into the section above.
      if (sectionLevel === 1 || level <= sectionLevel) {
        section = name;
        sectionLevel = level;
        subsection = null;
      } else {
        subsection = name;
      }
      continue;
    }
    depth = Math.max(0, depth + count(line, "{{") + count(line, "{|") - count(line, "}}") - count(line, "|}"));
    for (const piece of line.split(MARK)) {
      if (/^\d+$/.test(piece) && line.includes(`${MARK}${piece}${MARK}`)) {
        for (const entry of galleries[Number(piece)].split("\n")) {
          if (!entry.trim()) continue;
          const [target, ...options] = splitTopLevel(entry.trim());
          add(target, options);
        }
        continue;
      }
      for (const body of links(piece)) {
        const [target, ...options] = splitTopLevel(body);
        if (FILE_PREFIX.test(target) && !/^\s*:/.test(target)) add(target, options);
      }
    }
  }
  return found;
}

/** The images that help with the quest, once each, as written to the quest's page file. */
export function questImages(wikitext, title) {
  const seen = new Set();
  const images = [];
  for (const image of surveyImages(wikitext, title)) {
    if (image.leftOut || seen.has(image.file)) continue;
    seen.add(image.file);
    images.push({
      file: image.file,
      hashPath: hashPath(image.file),
      caption: image.caption,
      section: image.section,
      subsection: image.subsection,
    });
  }
  return images;
}

function count(text, token) {
  return text.split(token).length - 1;
}

/** The bodies of the file links in a line, including links nested in captions' templates. */
function links(text) {
  const bodies = [];
  for (let start = text.search(FILE_LINK); start >= 0; ) {
    let depth = 0;
    let end = -1;
    for (let index = start; index < text.length; index += 1) {
      if (text.startsWith("[[", index)) {
        depth += 1;
        index += 1;
      } else if (text.startsWith("]]", index)) {
        depth -= 1;
        index += 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    bodies.push(text.slice(start + 2, end - 2));
    const next = text.slice(end).search(FILE_LINK);
    start = next < 0 ? -1 : end + next;
  }
  return bodies;
}
