import { createHash } from "node:crypto";
import { wikiPageUrl } from "../src/app/lib/wiki/wiki-url.ts";
import { wikitextToPage } from "../src/app/lib/wiki/wikitext.ts";

export const SNAPSHOT_FORMAT = 1;

// First match wins; catalogue pages tarkov.dev serves are left out (see DATA_ARCHITECTURE.md).
const KEPT = [
  ["quest", (page) => page.infobox === "infobox quest" || page.categories.some((name) => /quests$/i.test(name))],
  // Traders are also characters, so they come first.
  ["trader", (page) => hasCategory(page, "Traders")],
  ["character", (page) => page.infobox === "infobox character" || hasCategory(page, "Bosses", "Factions", "Characters")],
  ["location", (page) => page.infobox === "infobox location" || hasCategory(page, "Locations", "Maps")],
  ["key", (page) => page.infobox === "infobox key" || hasCategory(page, "Keys", "Keycards")],
  ["container", (page) => hasCategory(page, "Loot Containers")],
  ["skill", (page) => page.infobox === "infobox skill" || page.categories.some((name) => /skills$/i.test(name))],
  [
    "game",
    (page) => hasCategory(page, "Escape from Tarkov", "Escape from Tarkov: Arena", "Game modes", "Story chapters"),
  ],
];

// Left out of get_wiki_page, but kept for the item page under items/ (see DATA_ARCHITECTURE.md).
const ITEM_PAGE_KINDS = new Set(["item", "weapon", "ammo"]);
const ITEM_ID = /^[0-9a-f]{24}$/;
// Item page sections that repeat what tarkov.dev serves (prices, uses, attachments) or hold only media.
const ITEM_SECTIONS_LEFT_OUT = new Set(
  [
    "Introduction", "Description", "Trading", "Crafting", "Hideout", "Quests", "Requirements", "Mods",
    "Gallery", "Layout", "Reticle", "Preview", "Vision", "Content", "See also", "Conflicting items",
  ].map((heading) => heading.toLowerCase())
);

const LEFT_OUT = [
  ["weapon", (page) => page.infobox === "infobox weapon" || page.infobox === "infobox magazine"],
  ["ammo", (page) => page.infobox === "infobox ammo" || hasCategory(page, "Rounds")],
  ["item", (page) => /^infobox (item|gear|throwable)$/.test(page.infobox)],
];

/** Newer when the published dump differs from the one the snapshot was built from. */
export function isNewer(manifest, published) {
  if (!manifest?.source) return true;
  if (published.lastModified && manifest.source.lastModified) {
    return Date.parse(published.lastModified) > Date.parse(manifest.source.lastModified);
  }
  return published.bytes !== manifest.source.bytes;
}

function hasCategory(page, ...names) {
  return names.some((name) => page.categories.includes(name));
}

const XML_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== "#") return XML_ENTITIES[code] ?? entity;
    return String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
  });
}

function field(xml, pattern) {
  const match = pattern.exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

export function readDumpPages(xml) {
  const pages = [];
  for (const [, body] of xml.matchAll(/<page>([\s\S]*?)<\/page>/g)) {
    if (field(body, /<ns>(\d+)<\/ns>/) !== "0") continue;
    const revision = /<revision>([\s\S]*?)<\/revision>/.exec(body)?.[1] ?? "";
    const wikitext = field(revision, /<text\b[^>]*>([\s\S]*?)<\/text>/) ?? "";
    const redirect = field(body, /<redirect title="([^"]*)"\s*\/>/);
    // The redirect element drops the section a redirect points at; its wikitext keeps it.
    const link = /^\s*#REDIRECT\s*:?\s*\[\[([^\]|]+)/i.exec(wikitext)?.[1] ?? "";
    const [linkTitle, fragment] = link.replace(/_/g, " ").split("#");
    const sameTarget = redirect && fragment?.trim() && linkTitle.trim().toLowerCase() === redirect.toLowerCase();
    pages.push({
      title: field(body, /<title>([\s\S]*?)<\/title>/),
      redirect: sameTarget ? `${redirect}#${fragment.trim()}` : redirect,
      revisionId: Number(field(revision, /<id>(\d+)<\/id>/)),
      lastEdited: field(revision, /<timestamp>([^<]+)<\/timestamp>/),
      wikitext,
    });
  }
  return pages;
}

function describe(page) {
  const text = page.wikitext.replace(/<!--[\s\S]*?(-->|$)/g, "");
  const templates = [...text.matchAll(/\{\{\s*([^|}\n]+?)\s*(?=[|}\n])/g)].map((match) => match[1].toLowerCase());
  const categories = [...text.matchAll(/\[\[\s*Category\s*:\s*([^\]|]+)/gi)].map((match) =>
    match[1].replace(/[‎‏]/g, "").replace(/_/g, " ").trim()
  );
  return {
    templates,
    infobox: templates.find((name) => name.startsWith("infobox")) ?? "",
    categories: [...new Set(categories)].toSorted(),
  };
}

export function classify(page) {
  const described = describe(page);
  if (described.templates.includes("historical content")) return { kept: false, kind: "historical" };
  for (const [kind, test] of KEPT) if (test(described)) return { kept: true, kind, categories: described.categories };
  for (const [kind, test] of LEFT_OUT) if (test(described)) return { kept: false, kind };
  return { kept: false, kind: "other" };
}

function slug(title) {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}

function shortHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function splitTarget(target) {
  const at = target.indexOf("#");
  return at < 0 ? { title: target } : { title: target.slice(0, at), fragment: target.slice(at + 1) || undefined };
}

/** Output depends only on the dump, so an unchanged dump rebuilds identically. */
export function buildSnapshot(xml, source) {
  const pages = readDumpPages(xml);
  const content = pages.filter((page) => !page.redirect);
  const kept = [];
  const itemPages = [];
  const leftOut = {};
  for (const page of content) {
    const verdict = classify(page);
    if (verdict.kept) kept.push({ ...page, kind: verdict.kind, categories: verdict.categories });
    else leftOut[page.title] = verdict.kind;
    if (!verdict.kept && ITEM_PAGE_KINDS.has(verdict.kind)) {
      itemPages.push({ ...page, kind: verdict.kind, categories: describe(page).categories });
    }
  }
  const byTitle = (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  kept.sort(byTitle);
  itemPages.sort(byTitle);

  const keptTitles = new Set(kept.map((page) => page.title));
  const redirects = {};
  const aliases = new Map();
  for (const page of pages.filter((entry) => entry.redirect)) {
    const target = splitTarget(page.redirect);
    if (keptTitles.has(target.title)) {
      redirects[page.title] = page.redirect;
      aliases.set(target.title, [...(aliases.get(target.title) ?? []), page.title]);
    } else if (leftOut[target.title]) {
      leftOut[page.title] = leftOut[target.title];
    }
  }

  const files = new Map();
  const index = [];
  const kinds = {};
  // Item pages tarkov.dev ids point at, from both sets: the item page reads them by id.
  const itemIds = {};
  const write = (set, directory) => {
    const slugCounts = new Map();
    for (const page of set) slugCounts.set(slug(page.title), (slugCounts.get(slug(page.title)) ?? 0) + 1);
    let bytes = 0;
    for (const page of set) {
      const parsed = wikitextToPage(page.wikitext, page.title);
      const { infobox } = parsed;
      const sections =
        directory === "items"
          ? parsed.sections.filter((section) => section.text && !ITEM_SECTIONS_LEFT_OUT.has(section.heading.toLowerCase()))
          : parsed.sections;
      const record = {
        title: page.title,
        url: wikiPageUrl(page.title),
        revisionId: page.revisionId,
        lastEdited: page.lastEdited,
        kind: page.kind,
        categories: page.categories,
        redirects: (aliases.get(page.title) ?? []).toSorted(),
        infobox,
        sections,
      };
      const file = `${slugCounts.get(slug(page.title)) > 1 ? `${slug(page.title)}-${shortHash(page.title)}` : slug(page.title)}.json`;
      const json = `${JSON.stringify(record, null, 2)}\n`;
      files.set(`${directory}/${file}`, json);
      bytes += Buffer.byteLength(json);
      const id = infobox.node?.trim();
      if (id && ITEM_ID.test(id) && !itemIds[id]) itemIds[id] = `${directory}/${file}`;
      if (directory === "pages") {
        index.push({ title: page.title, file, kind: page.kind, lastEdited: page.lastEdited });
        kinds[page.kind] = (kinds[page.kind] ?? 0) + 1;
      }
    }
    return bytes;
  };
  const pageBytes = write(kept, "pages");
  const itemPageBytes = write(itemPages, "items");

  const snapshotDate = pages.reduce((latest, page) => (page.lastEdited > latest ? page.lastEdited : latest), "");
  const sortedObject = (object) => Object.fromEntries(Object.entries(object).toSorted(([a], [b]) => (a < b ? -1 : 1)));
  files.set("index.json", lines({ format: SNAPSHOT_FORMAT, snapshotDate, pages: index, redirects: sortedObject(redirects) }));
  files.set("left-out.json", lines(sortedObject(leftOut)));
  files.set("item-ids.json", lines(sortedObject(itemIds)));
  const manifest = {
    format: SNAPSHOT_FORMAT,
    source,
    snapshotDate,
    builtWith: "node scripts/build-wiki-snapshot.mjs",
    pages: kept.length,
    kinds: sortedObject(kinds),
    redirects: Object.keys(redirects).length,
    leftOut: Object.keys(leftOut).length,
    pageBytes,
    itemPages: itemPages.length,
    itemIds: Object.keys(itemIds).length,
    itemPageBytes,
  };
  files.set("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, manifest };
}

/** JSON with one array entry or object member per line, so a new dump diffs line by line. */
function lines(value) {
  const entries = (object) =>
    Array.isArray(object)
      ? object.map((entry) => `  ${JSON.stringify(entry)}`)
      : Object.entries(object).map(([key, entry]) => `  ${JSON.stringify(key)}: ${JSON.stringify(entry)}`);
  if (Array.isArray(value) || Object.values(value).every((entry) => typeof entry !== "object" || entry === null)) {
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return `${open}\n${entries(value).join(",\n")}\n${close}\n`;
  }
  const members = Object.entries(value).map(([key, entry]) => {
    if (entry && typeof entry === "object" && Object.keys(entry).length > 0) {
      const [open, close] = Array.isArray(entry) ? ["[", "]"] : ["{", "}"];
      return `${JSON.stringify(key)}: ${open}\n${entries(entry).map((line) => `  ${line}`).join(",\n")}\n  ${close}`;
    }
    return `${JSON.stringify(key)}: ${JSON.stringify(entry)}`;
  });
  return `{\n  ${members.join(",\n  ")}\n}\n`;
}
