import { useSyncExternalStore } from "react";

/**
 * Experimental recolourings of the SVG maps, for comparing looks locally.
 * Only the development server honours them, through `?mapStyle=<name>` on a map page,
 * so production always shows the artwork in its original colours.
 */
export const SVG_MAP_STYLES = ["topo", "dusk"] as const;
export type SvgMapStyle = (typeof SVG_MAP_STYLES)[number];

export const SVG_MAP_STYLE_ENABLED = process.env.NODE_ENV !== "production";

export function parseSvgMapStyle(search: string): SvgMapStyle | null {
  if (!SVG_MAP_STYLE_ENABLED) return null;
  const value = new URLSearchParams(search).get("mapStyle");
  return SVG_MAP_STYLES.find((style) => style === value) ?? null;
}

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function useSvgMapStyle(): SvgMapStyle | null {
  return useSyncExternalStore(
    subscribe,
    () => parseSvgMapStyle(window.location.search),
    () => null
  );
}

export function svgMapStyleClass(style: SvgMapStyle) {
  return `rp-svg-style--${style}`;
}
