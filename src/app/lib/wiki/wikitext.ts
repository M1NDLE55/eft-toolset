// Supports this wiki's conventions; unsupported templates are dropped.

export interface WikiSection {
  /** "Introduction" for the text before the first heading. */
  heading: string;
  /** 1 for the introduction, otherwise the number of "=" around the heading. */
  level: number;
  text: string;
}

export const INTRODUCTION = "Introduction";

// Strip invisible characters that could conceal text from readers.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const HEADING = /^(={1,6})\s*(.+?)\s*\1\s*$/;
// Marks icon names so icons placed side by side read as a list.
const ICON = "\u001F";
const ICON_ONLY = /^\s*(\u001F[^\u001F]*\u001F\s*)+$/;
const FILE_LINK = /^\s*(file|image|media)\s*:/i;
const NAMESPACES_TO_DROP = /^:?\s*(file|image|media|category)\s*:/i;
const LANGUAGE_LINK = /^[a-z]{2,3}(-[a-z]+)?:/;
const INFOBOX_FIELDS_TO_DROP = /image|icon|size|caption|width|height/i;
const PAGE_NAME = /^(PAGENAME|PAGENAMEE|FULLPAGENAME|BASEPAGENAME|SUBPAGENAME)$/;

export interface WikiPageText {
  /** The page's infobox, as field name and plain-text value; empty when it has none. */
  infobox: Record<string, string>;
  sections: WikiSection[];
}

export function wikitextToPage(wikitext: string, title: string): WikiPageText {
  const text = stripHidden(wikitext);
  for (let index = text.indexOf("{{"); index >= 0; ) {
    const end = matchingEnd(text, index, "{{", "}}");
    if (end < 0) break;
    const [name, ...args] = splitTopLevel(text.slice(index + 2, end - 2));
    if (/^infobox\b/i.test(name.trim())) {
      return {
        infobox: Object.fromEntries(infoboxFields(args, title)),
        sections: wikitextToSections(text.slice(0, index) + text.slice(end), title),
      };
    }
    index = text.indexOf("{{", end);
  }
  return { infobox: {}, sections: wikitextToSections(text, title) };
}

export function wikitextToSections(wikitext: string, title: string): WikiSection[] {
  const sections: WikiSection[] = [];
  let current = { heading: INTRODUCTION, level: 1, lines: [] as string[] };
  const flush = () => {
    const text = wikitextToText(current.lines.join("\n"), title);
    // Headed sections are kept even when empty, since their subsections follow them.
    if (text || current.heading !== INTRODUCTION) sections.push({ heading: current.heading, level: current.level, text });
  };
  let depth = 0;
  for (const line of stripHidden(wikitext).split("\n")) {
    const heading = depth === 0 ? HEADING.exec(line) : null;
    if (heading) {
      flush();
      current = { heading: inlineText(heading[2], title) || heading[2], level: heading[1].length, lines: [] };
    } else {
      current.lines.push(line);
      // Headings inside templates and tables are not section breaks.
      depth = Math.max(0, depth + count(line, "{{") + count(line, "{|") - count(line, "}}") - count(line, "|}"));
    }
  }
  flush();
  return sections;
}

export function wikitextToText(wikitext: string, title: string): string {
  let text = convertTabs(stripHidden(wikitext));
  text = expandTemplates(text, title);
  text = convertLinks(text);
  text = convertTables(text);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = stripTags(text);
  text = decodeEntities(text);
  text = stripFormatting(joinIcons(text));
  return tidy(text.replace(INVISIBLE, ""));
}

function inlineText(wikitext: string, title: string) {
  return wikitextToText(wikitext, title).replace(/\s+/g, " ").trim();
}

function stripHidden(text: string) {
  return text
    .replace(INVISIBLE, "")
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<(gallery|noinclude|includeonly|script|style|math|timeline|templatedata)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(span|div)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/__[A-Z]+__/g, "");
}

function convertTabs(text: string) {
  return text.replace(/<tabber>([\s\S]*?)<\/tabber>/gi, (_, tabs: string) =>
    tabs.replace(/(^|\n)\s*(?:\|-\|)?\s*([^=\n|{}[\]]{1,60})=\s*(?=\n|$|\{\||[^=])/g, "$1\n$2:\n")
  );
}

function count(text: string, token: string) {
  return text.split(token).length - 1;
}

function matchingEnd(text: string, start: number, open: string, close: string) {
  let depth = 0;
  for (let index = start; index < text.length; ) {
    if (text.startsWith(open, index)) {
      depth += 1;
      index += open.length;
    } else if (text.startsWith(close, index)) {
      depth -= 1;
      index += close.length;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return -1;
}

function splitTopLevel(text: string) {
  const parts: string[] = [];
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

function expandTemplates(text: string, title: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("{{", index);
    if (start < 0) break;
    const end = matchingEnd(text, start, "{{", "}}");
    if (end < 0) {
      out += text.slice(index, start);
      index = start + 2;
      continue;
    }
    out += text.slice(index, start) + expandTemplate(text.slice(start + 2, end - 2), title);
    index = end;
  }
  return out + text.slice(index);
}

function expandTemplate(body: string, title: string): string {
  const [rawName, ...args] = splitTopLevel(body);
  const name = rawName.trim();
  const positional = args.filter((arg) => !/^\s*[\w ]+\s*=/.test(arg));
  if (PAGE_NAME.test(name)) return title;
  if (/^infobox\b/i.test(name)) {
    const lines = infoboxFields(args, title).map(([key, value]) => `${key}: ${value}`);
    return lines.length > 0 ? `\n${lines.join("\n")}\n` : "";
  }
  if (/^quote$/i.test(name) && positional[0]) {
    const author = positional[1]?.trim();
    return `"${expandTemplates(positional[0], title).trim()}"${author ? ` (${author})` : ""}`;
  }
  if (/^seasonal change$/i.test(name) && positional[0]) {
    return `Seasonal change: ${expandTemplates(positional[0], title).trim()}`;
  }
  // Navigation boxes, item-id templates, file paths, and layout helpers carry nothing
  // readable without the wiki's own rendering.
  return "";
}

function infoboxFields(args: string[], title: string): [string, string][] {
  return args.flatMap((arg) => {
    const split = arg.indexOf("=");
    if (split < 0) return [];
    const key = arg.slice(0, split).trim();
    const value = inlineText(arg.slice(split + 1).replace(/<br\s*\/?>/gi, ", "), title);
    return key && value && !INFOBOX_FIELDS_TO_DROP.test(key) ? [[key, value]] : [];
  });
}

function convertLinks(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("[[", index);
    if (start < 0) break;
    const end = matchingEnd(text, start, "[[", "]]");
    if (end < 0) {
      // The wiki has some unclosed links; drop the brackets and read on.
      out += text.slice(index, start);
      index = start + 2;
      continue;
    }
    out += text.slice(index, start) + linkText(text.slice(start + 2, end - 2));
    index = end;
  }
  out += text.slice(index);
  return out
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\]/g, "");
}

function linkText(body: string) {
  const [target, ...labels] = splitTopLevel(body);
  if (FILE_LINK.test(target)) {
    // Item icons link to the item, and are often the only place a table names it.
    const link = labels.map((label) => /^\s*link\s*=(.*)$/i.exec(label)?.[1].trim()).find(Boolean);
    if (!link || /^(https?:)?\/\//i.test(link)) return "";
    const name = link.replace(/_/g, " ");
    // Amounts are drawn as icons too, such as "5000 Roubles.png" linking to Roubles.
    const amount = /^\s*(?:file|image|media)\s*:\s*(\d[\d,.]*)\s+(.+?)\.\w+\s*$/i.exec(target);
    return `${ICON}${amount && amount[2].toLowerCase() === name.toLowerCase() ? `${amount[1]} ${name}` : name}${ICON}`;
  }
  if (NAMESPACES_TO_DROP.test(target) || LANGUAGE_LINK.test(target.trim())) return "";
  // Labels may themselves hold links once templates are expanded.
  if (labels.length > 0) return convertLinks(labels.join("|"));
  const [page, fragment] = target.replace(/^:/, "").split("#");
  return (page || fragment || "").replace(/_/g, " ").trim();
}

function convertTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const stack: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // A table may open inside a list item, as ":{|".
    if (/^[*#:;]*\s*\{\|/.test(trimmed)) {
      stack.push([]);
    } else if (trimmed.startsWith("|}") && stack.length > 0) {
      const rows = tableRows(stack.pop()!);
      if (stack.length > 0) stack[stack.length - 1].push(rows.join("; "));
      else out.push(...rows);
    } else if (stack.length > 0) {
      stack[stack.length - 1].push(line);
    } else {
      out.push(line);
    }
  }
  while (stack.length > 0) out.push(...tableRows(stack.shift()!));
  return out.join("\n");
}

function tableRows(lines: string[]) {
  const rows: { cells: string[]; header: boolean }[] = [];
  let row: string[] = [];
  let header = true;
  const endRow = () => {
    if (row.length > 0) rows.push({ cells: row, header });
    row = [];
    header = true;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|-")) endRow();
    else if (trimmed.startsWith("|+")) continue;
    else if (trimmed.startsWith("!")) row.push(...trimmed.slice(1).split(/!!|\|\|/).map(cellContent));
    else if (trimmed.startsWith("|")) {
      header = false;
      row.push(...trimmed.slice(1).split("||").map(cellContent));
    }
    else if (row.length > 0) row[row.length - 1] += `\n${line}`;
  }
  endRow();
  const cleaned = rows.map((entry) => entry.cells.map(cellText));
  const iconOnly = rows.map((entry) => entry.cells.map((cell) => ICON_ONLY.test(stripTags(cell))));
  const width = Math.max(0, ...cleaned.map((cells) => cells.length));
  const bodyIndexes = rows.flatMap((entry, index) => (entry.header ? [] : [index]));
  const body = bodyIndexes.length > 0 ? bodyIndexes : rows.map((_, index) => index);
  const repeatsNeighbour = (row: number, column: number) =>
    iconOnly[row][column] &&
    (cleaned[row][column] === cleaned[row][column - 1] || cleaned[row][column] === cleaned[row][column + 1]);
  const keep = Array.from(
    { length: width },
    (_, column) =>
      body.some((row) => cleaned[row][column]) &&
      !body.every((row) => !cleaned[row][column] || repeatsNeighbour(row, column))
  );
  return cleaned
    .map((cells) => cells.filter((_, column) => keep[column]))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => `| ${cells.join(" | ")} |`);
}

function cellContent(cell: string) {
  const parts = splitTopLevel(cell);
  if (parts.length > 1 && /^\s*[\w-]+\s*=/.test(parts[0])) return parts.slice(1).join("|");
  return cell;
}

function cellText(cell: string) {
  const text = decodeEntities(stripTags(joinIcons(cell).replace(/<br\s*\/?>/gi, "\n")));
  return stripFormatting(text)
    .split("\n")
    .map((line) => line.replace(/^[*#:;]+\s*/, "").trim())
    .filter(Boolean)
    .join("; ")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function joinIcons(text: string) {
  return text.replace(new RegExp(`${ICON}[ \\t]*${ICON}`, "g"), ", ").replace(new RegExp(ICON, "g"), "");
}

function stripTags(text: string) {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", times: "×" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  });
}

function stripFormatting(text: string) {
  return text
    .replace(/'{2,5}/g, "")
    .replace(/✔|✓/g, "yes")
    .replace(/✘|✗|❌/g, "no");
}

function tidy(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const list = /^([*#:;]+)\s*(.*)$/.exec(line);
      const body = (list ? list[2] : line).replace(/[ \t]+/g, " ").trim();
      if (!body) return "";
      return list ? `${"  ".repeat(list[1].length - 1)}- ${body}` : body;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
