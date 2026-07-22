const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
]);

export function parseSafeSvg(source: string): SVGSVGElement {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("Map SVG could not be parsed.");

  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg") throw new Error("Map asset is not an SVG.");
  root.setAttribute("data-rp-map", "");

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (BLOCKED_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        if (value && !value.startsWith("#")) element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        const safeStyle = value
          .replace(/@import[^;]+;?/gi, "")
          .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, _quote, target: string) =>
            target.trim().startsWith("#") ? `url(${target.trim()})` : ""
          )
          .trim();
        if (safeStyle) element.setAttribute(attribute.name, safeStyle);
        else element.removeAttribute(attribute.name);
      }
    }
  }

  for (const style of Array.from(root.querySelectorAll("style"))) {
    const sanitized = (style.textContent ?? "")
      .replace(/@import[^;]+;?/gi, "")
      .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, _quote, target: string) =>
        target.trim().startsWith("#") ? `url(${target.trim()})` : ""
      );
    if (sanitized.includes("@")) {
      style.remove();
      continue;
    }
    style.textContent = sanitized.replace(
      /(^|})\s*([^{}]+)\s*{/g,
      (_match, boundary: string, selectors: string) =>
        `${boundary}${selectors
          .split(",")
          .map((selector) => `[data-rp-map] ${selector.trim()}`)
          .join(",")}{`
    );
  }

  return root as unknown as SVGSVGElement;
}
