import { customEncodeURI } from "./URIEncoding";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;

export function isItemSlug(value: string) {
  return SLUG_PATTERN.test(value);
}

export function itemHref(item: { name: string; normalizedName?: string | null }) {
  const slug = item.normalizedName;
  return `/item/${slug && isItemSlug(slug) ? slug : customEncodeURI(item.name)}`;
}
