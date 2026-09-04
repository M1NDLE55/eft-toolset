const MAX_SVG_SOURCE_CHARS = 8 * 1024 * 1024;
const MAX_SVG_ELEMENTS = 100_000;

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "a", "defs", "title", "desc", "metadata", "path", "rect", "circle",
  "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath", "use",
  "symbol", "marker", "clippath", "mask", "pattern", "lineargradient",
  "radialgradient", "stop", "filter", "fegaussianblur", "feoffset", "femerge",
  "femergenode", "fecolormatrix", "fecomponenttransfer", "fefunca", "fefuncr",
  "fefuncg", "fefuncb", "feblend", "fecomposite", "feflood", "style",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "id", "class", "style", "role", "tabindex", "focusable", "xmlns", "viewbox",
  "preserveaspectratio", "transform", "d", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "width", "height", "points", "pathlength",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "opacity", "display", "visibility", "clip-path", "clip-rule",
  "mask", "filter", "color", "stop-color", "stop-opacity", "offset", "gradientunits",
  "gradienttransform", "spreadmethod", "patternunits", "patterncontentunits",
  "patterntransform", "marker-start", "marker-mid", "marker-end", "markerwidth",
  "markerheight", "markerunits", "refx", "refy", "orient", "font-family", "font-size",
  "font-style", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing",
  "word-spacing", "text-decoration", "paint-order", "vector-effect", "flood-color",
  "flood-opacity", "in", "in2", "result", "stddeviation", "dx", "dy", "mode",
  "operator", "values", "type", "slope", "intercept", "amplitude", "exponent",
  "tablevalues", "href", "xlink:href",
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "opacity", "display", "visibility", "clip-path", "clip-rule",
  "mask", "filter", "color", "stop-color", "stop-opacity", "font-family", "font-size",
  "font-style", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing",
  "word-spacing", "text-decoration", "paint-order", "vector-effect", "flood-color",
  "flood-opacity",
]);

const LOCAL_REFERENCE = /^#[A-Za-z_][\w:.-]*$/;

export function parseSafeSvg(source: string): SVGSVGElement {
  if (source.length > MAX_SVG_SOURCE_CHARS || /<!\s*(?:doctype|entity)/i.test(source)) {
    throw new Error("Map SVG exceeds the safe parsing limits.");
  }

  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("Map SVG could not be parsed.");

  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg") throw new Error("Map asset is not an SVG.");
  const descendants = Array.from(root.querySelectorAll("*"));
  if (descendants.length > MAX_SVG_ELEMENTS) throw new Error("Map SVG contains too many elements.");
  root.setAttribute("data-rp-map", "");

  for (const element of [root, ...descendants]) {
    const elementName = element.localName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(elementName)) {
      element.remove();
      continue;
    }
    if (elementName === "style") {
      const css = sanitizeStyleSheet(element.textContent ?? "");
      if (css) element.textContent = css;
      else element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const allowedData = name.startsWith("data-") && /^[a-z0-9_.:-]+$/.test(name);
      const allowedAria = name.startsWith("aria-") && /^[a-z0-9_.:-]+$/.test(name);
      if (name.startsWith("on") || (!ALLOWED_ATTRIBUTES.has(name) && !allowedData && !allowedAria)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        if (!LOCAL_REFERENCE.test(value)) element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        const style = sanitizeDeclarations(value);
        if (style) element.setAttribute(attribute.name, style);
        else element.removeAttribute(attribute.name);
        continue;
      }
      const safeValue = sanitizeCssValue(value);
      if (safeValue === null) element.removeAttribute(attribute.name);
      else if (safeValue !== value) element.setAttribute(attribute.name, safeValue);
    }
  }

  return root as unknown as SVGSVGElement;
}

function sanitizeStyleSheet(value: string): string {
  const source = value.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!source || source.includes("@") || source.includes("\\")) return "";
  const rules: string[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = rulePattern.exec(source))) {
    if (source.slice(consumed, match.index).trim()) return "";
    consumed = rulePattern.lastIndex;
    const selectors = match[1].split(",").map((selector) => selector.trim());
    if (selectors.some((selector) => !selector || selector.length > 500 || !/^[A-Za-z0-9_.#* >+~:-]+$/.test(selector))) return "";
    const declarations = sanitizeDeclarations(match[2]);
    if (!declarations) continue;
    rules.push(`${selectors.map((selector) => `[data-rp-map] ${selector}`).join(",")}{${declarations}}`);
  }
  if (source.slice(consumed).trim()) return "";
  return rules.join("");
}

function sanitizeDeclarations(value: string): string {
  const declarations: string[] = [];
  for (const raw of value.split(";")) {
    if (!raw.trim()) continue;
    const colon = raw.indexOf(":");
    if (colon <= 0) continue;
    const property = raw.slice(0, colon).trim().toLowerCase();
    const candidate = raw.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    const safe = sanitizeCssValue(candidate);
    if (safe !== null && safe.length <= 1_000) declarations.push(`${property}:${safe}`);
    else if (property === "fill" || property === "stroke") declarations.push(`${property}:none`);
  }
  return declarations.join(";");
}

function sanitizeCssValue(value: string): string | null {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || /(?:javascript|expression|behavior|-moz-binding|@|\\)/i.test(value)) return null;
  let unsafeReference = false;
  const safe = value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, _quote, target: string) => {
    const reference = target.trim();
    if (LOCAL_REFERENCE.test(reference)) return `url(${reference})`;
    unsafeReference = true;
    return "";
  });
  return unsafeReference ? null : safe;
}
