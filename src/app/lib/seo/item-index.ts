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
  /** False for items the flea market can't trade (tarkov.dev's noFlea type). */
  tradeable: boolean;
  /** The handbook price traders' prices are based on; null when unknown. */
  basePrice: number | null;
}

/**
 * Decides each item page's indexing:
 * - Ammo packs are noindex: the page repeats the round's own page with a pack price, and pointing
 *   a canonical at the round would claim they're the same item, which they aren't.
 * - A weapon's default preset ("… Default") points its canonical at the weapon: the weapon's page
 *   already prices its default build.
 * - Items sharing one name (Twitch drop cases, dogtags, sealed weapon cases, gear crates), which
 *   tarkov.dev tells apart only by a number on the slug, point their canonical at the shortest
 *   slug (the one without a number, else the lowest): one page per name. A copy that can be
 *   traded on the flea market at a base price of its own (a second Folding car key) is a
 *   different item that happens to share the name, and stays. These are stable item facts, not
 *   live prices, so a page's canonical doesn't flip from one data refresh to the next.
 * Canonicals are then followed to their final page, so none points at a page that isn't indexed.
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
    // Shortest first: "foo" before "foo-3", "foo-3" before "foo-15", and "foo-545" before "foo-545-1".
    const representative = group.toSorted((a, b) => a.slug.length - b.slug.length || a.slug.localeCompare(b.slug))[0];
    for (const item of group) {
      const distinct = item.tradeable && item.basePrice !== null && item.basePrice !== representative.basePrice;
      if (item !== representative && !distinct) result.set(item.slug, { kind: "canonical", slug: representative.slug, reason: "same-name" });
    }
  }
  for (const item of items) if (!result.has(item.slug)) result.set(item.slug, { kind: "index" });
  for (const [slug, entry] of result) {
    if (entry.kind !== "canonical") continue;
    let target: ItemIndexing | undefined = entry;
    let to = entry.slug;
    for (let hops = 0; target?.kind === "canonical" && hops < 10; hops += 1) {
      to = target.slug;
      target = result.get(to);
    }
    // A chain ending at a page left out of search leaves this one out too; one ending in a loop, indexed.
    if (target?.kind === "noindex") result.set(slug, target);
    else if (target?.kind === "index") result.set(slug, { ...entry, slug: to });
    else result.set(slug, { kind: "index" });
  }
  return result;
}

/** The item pages the sitemap lists: the indexed ones, with when tarkov.dev last updated each. */
export function itemSitemapEntries(pages: ReadonlyMap<string, { indexing: ItemIndexing; updated: string | null }>) {
  return Array.from(pages, ([slug, page]) => (page.indexing.kind === "index" ? [{ path: `/item/${slug}`, lastModified: page.updated }] : [])).flat();
}
