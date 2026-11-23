// The compact item index: what item search, name matching and category filters need from
// tarkov.dev's items file (names, short names, images, slugs, types, categories, calibers), without
// the prices that make that file 17 MB and change every few minutes. The snapshot build writes one
// per game mode (scripts/build-tarkov-snapshot.mjs), and the adapter derives a newer one from a newer
// items copy it already holds (src/app/lib/api/item-index.ts). See DATA_ARCHITECTURE.md.
//
// It must give exactly what the adapter's item catalog and item facets gave from the items file.
// Categories are stored once per tree, as [name, normalizedName, parent index], and items refer to
// them by index, so the adapter expands each item's category labels at load.

export const ITEM_INDEX_VERSION = 1;

/**
 * @typedef {[name: string, normalizedName: string, parent: number]} IndexCategory
 * @typedef {[
 *   id: string,
 *   name: string,
 *   shortName: string | null,
 *   image: string | null,
 *   normalizedName: string | null,
 *   types: number[],
 *   handbookCategories: number[],
 *   itemCategories: number[],
 *   caliber: number,
 * ]} IndexItem
 * @typedef {{
 *   version: number,
 *   types: string[],
 *   calibers: string[],
 *   handbook: IndexCategory[],
 *   categories: IndexCategory[],
 *   items: IndexItem[],
 * }} ItemIndex
 */

/**
 * @param {any} itemsData the items file's data field
 * @param {Record<string, string>} translations the items_en file's data field
 * @returns {ItemIndex}
 */
export function buildItemIndex(itemsData, translations) {
  const translate = (value) => (value ? (translations[value] ?? value) : "");
  const types = interner();
  const calibers = interner();
  const handbook = categoryTable(itemsData?.handbookCategories ?? {}, translate);
  const categories = categoryTable(itemsData?.itemCategories ?? {}, translate);
  const items = [];
  for (const item of Object.values(itemsData?.items ?? {})) {
    if (!item.id) continue;
    const caliber = item.properties?.caliber ?? null;
    items.push([
      item.id,
      translate(item.name),
      item.shortName === null || item.shortName === undefined ? null : translate(item.shortName),
      catalogImage(item.id, item.gridImageLink),
      item.normalizedName ?? null,
      (item.types ?? []).map(types.add),
      // Ids missing from the tree add no labels, so they are left out.
      (item.handbookCategories ?? []).flatMap((id) => (handbook.ids.has(id) ? [handbook.ids.get(id)] : [])),
      (item.categories ?? []).flatMap((id) => (categories.ids.has(id) ? [categories.ids.get(id)] : [])),
      caliber === null ? -1 : calibers.add(caliber),
    ]);
  }
  return {
    version: ITEM_INDEX_VERSION,
    types: types.values,
    calibers: calibers.values,
    handbook: handbook.rows,
    categories: categories.rows,
    items,
  };
}

/**
 * Whether a parsed value looks like an index this version can read.
 * @param {any} value
 * @returns {value is ItemIndex}
 */
export function isItemIndex(value) {
  return (
    Boolean(value) &&
    value.version === ITEM_INDEX_VERSION &&
    [value.types, value.calibers, value.handbook, value.categories, value.items].every(Array.isArray)
  );
}

function interner() {
  const indexes = new Map();
  const values = [];
  return {
    values,
    add: (value) => {
      if (!indexes.has(value)) indexes.set(value, values.push(value) - 1);
      return indexes.get(value);
    },
  };
}

/** The tree's categories in its own order, each with its parent's index (-1 when it has none in the tree). */
function categoryTable(tree, translate) {
  const ids = new Map(Object.keys(tree).map((id, index) => [id, index]));
  const rows = Object.values(tree).map((category) => [
    translate(category?.name),
    category?.normalizedName || "",
    category?.parent && ids.has(category.parent) ? ids.get(category.parent) : -1,
  ]);
  return { ids, rows };
}

/** The grid image's path on assets.tarkov.dev, "" for the usual `<id>-grid-image.webp`, or null. */
function catalogImage(id, link) {
  if (typeof link !== "string" || link.length === 0 || link.length > 2_048) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "assets.tarkov.dev") return null;
  const path = url.pathname.slice(1);
  return path === `${id}-grid-image.webp` ? "" : path;
}
