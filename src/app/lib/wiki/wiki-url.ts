// No imports: scripts/build-wiki-snapshot.mjs loads this file directly with Node.

export const WIKI_ORIGIN = "https://escapefromtarkov.fandom.com";
export const WIKI_NAME = "Escape from Tarkov Wiki";
/** As the wiki's own API states it (meta=siteinfo, rightsinfo). */
export const WIKI_LICENCE = { name: "CC BY-NC-SA", url: "https://www.fandom.com/licensing" };

export function wikiPageUrl(title: string, fragment?: string) {
  const path = encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":");
  return `${WIKI_ORIGIN}/wiki/${path}${fragment ? `#${encodeURIComponent(fragment.replace(/ /g, "_"))}` : ""}`;
}
