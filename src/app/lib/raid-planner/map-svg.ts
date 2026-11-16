import { parseSafeSvg } from "./sanitize-svg";
import type { MapConfig } from "./types";

const HIDDEN_GROUP_CLASS = "rp-hidden";
const DIMMED_GROUP_CLASS = "rp-dimmed";

const MAX_MAP_SVG_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_SVGS = 4;
const cache = new Map<string, Promise<SVGSVGElement>>();

export function loadMapSvg(path: string): Promise<SVGSVGElement> {
  const cached = cache.get(path);
  if (cached) return cached;
  const pending = fetch(path)
    .then((response) => {
      if (!response.ok) throw new Error(`Map image request failed (${response.status}).`);
      return readTextWithLimit(response, MAX_MAP_SVG_BYTES);
    })
    .then(parseSafeSvg);
  pending.catch(() => cache.delete(path));
  cache.set(path, pending);
  if (cache.size > MAX_CACHED_SVGS) cache.delete(cache.keys().next().value!);
  return pending;
}

export async function fillMapSvg(target: SVGSVGElement, path: string) {
  const source = await loadMapSvg(path);
  const viewBox = source.getAttribute("viewBox");
  if (viewBox) target.setAttribute("viewBox", viewBox);
  target.replaceChildren(
    ...Array.from(source.childNodes, (node) => target.ownerDocument.importNode(node, true))
  );
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("The map image is too large.");
  }
  if (!response.body) throw new Error("The map image response was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("Map image exceeded its size limit.");
        throw new Error("The map image is too large.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

/**
 * The element whose child groups are the map's floors. The tarkov.dev SVGs put the
 * floor groups straight under the root, after <style> and <defs>; older files wrapped
 * them in one more group, so look one level down as well.
 */
export function findFloorContainer(svg: Element, baseLayer: string | undefined): Element | null {
  const hasBase = (element: Element) =>
    Array.from(element.children).some((child) => child.nodeName === "g" && child.id === baseLayer);
  if (hasBase(svg)) return svg;
  return Array.from(svg.children).find(hasBase) ?? null;
}

/** Shows the base level plus the active floor, fading the base while a floor is picked. */
export function applySvgFloor(
  svg: Element,
  config: Pick<MapConfig, "svgLayer" | "floors">,
  activeFloor: string | null
) {
  const container = findFloorContainer(svg, config.svgLayer);
  if (!container) return;
  const activeGroupId = config.floors.find((floor) => floor.id === activeFloor)?.svgLayer;

  for (const child of Array.from(container.children)) {
    if (child.nodeName !== "g" || !child.id) continue;
    const isBase =
      child.id === config.svgLayer ||
      (child as SVGGElement).dataset?.["keepWithGroup"] === config.svgLayer;

    if (isBase) {
      child.classList.remove(HIDDEN_GROUP_CLASS);
      child.classList.toggle(DIMMED_GROUP_CLASS, Boolean(activeGroupId));
    } else if (activeGroupId && child.id === activeGroupId) {
      child.classList.remove(HIDDEN_GROUP_CLASS, DIMMED_GROUP_CLASS);
    } else {
      child.classList.add(HIDDEN_GROUP_CLASS);
      child.classList.remove(DIMMED_GROUP_CLASS);
    }
  }
}
