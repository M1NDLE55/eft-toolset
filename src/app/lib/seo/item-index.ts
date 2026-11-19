/** What an item page tells search engines, and whether the sitemap lists it. */
export type ItemIndexing =
  | { kind: "index" }
  /** A near-duplicate of another item's page, which search engines should show instead. */
  | { kind: "canonical"; slug: string; reason: "default-preset" | "same-name" }
  /** A page not worth showing in search on its own; its links are still followed. */
  | { kind: "noindex"; reason: "ammo-pack" };

export interface IndexableItem {
  id: string;
  slug: string;
  name: string;
  types: readonly string[];
  /** For presets: the weapon (or other item) the preset is built on. */
  baseItemId: string | null;
  /** True when the flea market has a price of its own for it: then it's an item in its own right. */
  traded: boolean;
}

const NUMBERED = /-\d+$/;

/**
 * Decides each item page's indexing:
 * - Ammo packs are noindex: the page repeats the round's own page with a pack price, and pointing
 *   a canonical at the round would claim they're the same item, which they aren't.
 * - A weapon's default preset ("… Default") points its canonical at the weapon: the weapon's page
 *   already prices its default build.
 * - Items sharing one name (Twitch drop cases, dogtags, sealed weapon cases, gear crates), which
 *   tarkov.dev tells apart only by a number on the slug, point their canonical at the one without
 *   a number (else the lowest number): one page per name. A copy the flea market prices on its
 *   own (a second Folding car key) is a different item that happens to share the name, and stays.
 * Everything else is indexed.
 */
export function itemIndexing(items: readonly IndexableItem[]): Map<string, ItemIndexing> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result = new Map<string, ItemIndexing>();
  for (const item of items) {
    if (item.types.includes("ammoBox")) result.set(item.slug, { kind: "noindex", reason: "ammo-pack" });
  }
  for (const item of items) {
    if (result.has(item.slug) || !item.types.includes("preset") || !item.baseItemId) continue;
    const base = byId.get(item.baseItemId);
    if (base && base.slug !== item.slug && item.name === `${base.name} Default` && !result.has(base.slug)) {
      result.set(item.slug, { kind: "canonical", slug: base.slug, reason: "default-preset" });
    }
  }
  const byName = new Map<string, IndexableItem[]>();
  for (const item of items) {
    if (result.has(item.slug)) continue;
    byName.set(item.name, [...(byName.get(item.name) ?? []), item]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const representative = group.toSorted((a, b) => numberOf(a.slug) - numberOf(b.slug) || a.slug.localeCompare(b.slug))[0];
    for (const item of group) {
      if (item !== representative && !item.traded) result.set(item.slug, { kind: "canonical", slug: representative.slug, reason: "same-name" });
    }
  }
  for (const item of items) if (!result.has(item.slug)) result.set(item.slug, { kind: "index" });
  return result;
}

/** The number tarkov.dev appends to a repeated name's slug; -1 for none, so the plain slug comes first. */
function numberOf(slug: string) {
  const match = NUMBERED.exec(slug);
  return match ? Number(match[0].slice(1)) : -1;
}

/** The item pages the sitemap lists: the indexed ones, with when tarkov.dev last updated each. */
export function itemSitemapEntries(pages: ReadonlyMap<string, { indexing: ItemIndexing; updated: string | null }>) {
  return Array.from(pages, ([slug, page]) => (page.indexing.kind === "index" ? [{ path: `/item/${slug}`, lastModified: page.updated }] : [])).flat();
}
