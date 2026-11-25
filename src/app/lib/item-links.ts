import type { ItemReference } from "@/app/lib/cache/fetcher";
import { customDecodeURI, customEncodeURI } from "./URIEncoding";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;

export function isItemSlug(value: string) {
  return SLUG_PATTERN.test(value);
}

/** What an /item/<segment> URL asks for: a slug, or an old name link's name. Null when the name decodes to nothing. */
export function itemReference(segment: string): ItemReference | null {
  if (isItemSlug(segment)) return { slug: segment };
  const name = customDecodeURI(segment);
  return name ? { name } : null;
}

export function itemHref(item: { name: string; normalizedName?: string | null }) {
  const slug = item.normalizedName;
  return `/item/${slug && isItemSlug(slug) ? slug : customEncodeURI(item.name)}`;
}
