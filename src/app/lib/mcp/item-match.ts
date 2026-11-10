import type { ItemMatch } from "@/app/lib/search/item-reference";

// Wording shared by the tools that resolve item names, so notes and errors read the same.

type FoundMatch = Extract<ItemMatch, { status: "found" }>;

/** True when the match is not an exact id, slug, name, or unique short name. */
export function isInexact(match: FoundMatch) {
  return match.matchedBy === "search" || match.matchedBy === "fuzzy" || Boolean(match.assumed);
}

/** Explains a match that wasn't exact, for notes and errors. */
export function describeInexact(reference: string, match: FoundMatch) {
  if (match.assumed) return match.assumed;
  if (match.matchedBy === "fuzzy") return `No item matches "${reference}"; using the closest spelling, ${match.item.name}.`;
  return `No exact match for "${reference}"; using the best search match.`;
}

/** The message for a reference that resolved to no single item. */
export function unmatchedMessage(reference: string, match: Exclude<ItemMatch, FoundMatch>) {
  if (match.status === "ambiguous") {
    return `"${reference}" could be any of: ${match.candidates.join("; ")}. Use the full name of the one you mean.`;
  }
  return match.suggestions.length
    ? `No item matches "${reference}". Did you mean: ${match.suggestions.join("; ")}?`
    : `No item matches "${reference}". Try search_items with fewer or different words.`;
}

