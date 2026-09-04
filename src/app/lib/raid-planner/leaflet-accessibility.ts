import L from "leaflet";

type ElementLayer = L.Layer & {
  getElement?: () => HTMLElement | SVGElement | null;
  getPopup?: () => L.Popup | undefined;
  openPopup?: () => unknown;
  openTooltip?: () => unknown;
  closeTooltip?: () => unknown;
};

export function makeLayerAccessible(
  layer: L.Layer,
  label: string,
  activate?: () => void
) {
  const accessible = layer as ElementLayer;
  layer.on("add", () => {
    const element = accessible.getElement?.();
    if (!element) return;
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", label);
    element.setAttribute("role", activate || accessible.getPopup?.() ? "button" : "img");
    if (element.getAttribute("data-rp-keyboard") === "true") return;
    element.setAttribute("data-rp-keyboard", "true");
    element.addEventListener("focus", () => accessible.openTooltip?.());
    element.addEventListener("blur", () => accessible.closeTooltip?.());
    element.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
      if (!activate && !accessible.getPopup?.()) return;
      keyboardEvent.preventDefault();
      if (activate) activate();
      else accessible.openPopup?.();
    });
  });
}
