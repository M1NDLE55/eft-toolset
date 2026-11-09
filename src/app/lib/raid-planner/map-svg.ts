import { parseSafeSvg } from "./sanitize-svg";

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
