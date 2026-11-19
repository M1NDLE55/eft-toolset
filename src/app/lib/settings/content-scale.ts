import type { StoreDefinition } from "@/app/lib/storage/versioned-store";

/**
 * Content size: how large the page contents render, as a percentage of the original design.
 * "default" follows DEFAULT_CONTENT_SCALE, so a later change to the default reaches visitors who
 * never picked a size. Kept free of React so the root layout can build its inline script from it.
 */
export const CONTENT_SCALES = [100, 112.5, 125, 137.5, 150] as const;

export type ContentScalePercent = (typeof CONTENT_SCALES)[number];
export type ContentScale = "default" | ContentScalePercent;

/** Matches `--content-scale` on :root in globals.css. */
export const DEFAULT_CONTENT_SCALE: ContentScalePercent = 125;

/** The CSS custom property on <html> that globals.css turns into `--content-zoom`. */
export const CONTENT_SCALE_PROPERTY = "--content-scale";

export function isContentScale(value: unknown): value is ContentScale {
  return value === "default" || CONTENT_SCALES.includes(value as ContentScalePercent);
}

export const CONTENT_SCALE_STORE: StoreDefinition<ContentScale> = {
  key: "eft-toolset:settings:content-scale",
  version: 1,
  defaultValue: () => "default",
  validate: isContentScale,
};

export function contentScalePercent(scale: ContentScale): ContentScalePercent {
  return scale === "default" ? DEFAULT_CONTENT_SCALE : scale;
}

/** Sets the saved size on <html>, or clears it so the stylesheet default applies. */
export function applyContentScale(root: HTMLElement, scale: ContentScale) {
  if (scale === "default") root.style.removeProperty(CONTENT_SCALE_PROPERTY);
  else root.style.setProperty(CONTENT_SCALE_PROPERTY, String(scale / 100));
}

/**
 * The blocking script in <head>: reads the saved size from localStorage before the body is
 * parsed, so the page never paints at the wrong size. Only a known value is applied; anything
 * else leaves the stylesheet default. Mirrors applyContentScale and the store's
 * `{ version, data }` envelope; tests run it against both.
 */
export function contentScaleScript() {
  return `(function(){try{var v=JSON.parse(localStorage.getItem(${JSON.stringify(CONTENT_SCALE_STORE.key)})||"null");var s=v&&typeof v==="object"?(v.version===${CONTENT_SCALE_STORE.version}?v.data:null):v;if(${JSON.stringify(CONTENT_SCALES)}.indexOf(s)>-1)document.documentElement.style.setProperty(${JSON.stringify(CONTENT_SCALE_PROPERTY)},String(s/100))}catch(e){}})()`;
}
