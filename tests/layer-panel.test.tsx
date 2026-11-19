import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerPanel } from "@/app/components/raid-planner/layer-panel";
import { LayerIcon } from "@/app/components/raid-planner/layer-icon";
import type { LayerGroupOptions } from "@/app/lib/raid-planner/layer-options";

const groups: LayerGroupOptions[] = [
  { name: "Points of interest", options: [{ id: "locks", label: "Locks", count: 12 }, { id: "hazards", label: "Hazards", count: 3 }] },
  { name: "Loot containers", options: [{ id: "loot:safe", label: "Safe", count: 4 }] },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.getElementById("rp-icon-sprite")?.remove();
});

describe("layer panel", () => {
  it("shows each layer's map icon beside its name, hidden from screen readers", () => {
    act(() =>
      root.render(
        <LayerPanel groups={groups} enabled={new Set(["locks"])} onChange={() => {}} loading={false} error={false} onRetry={() => {}} openOnWideScreens />
      )
    );
    const rows = Array.from(host.querySelectorAll<HTMLElement>('[role="checkbox"]'));
    expect(rows.map((row) => row.textContent)).toEqual(["Locks12", "Hazards3", "Safe4"]);
    expect(rows.map((row) => row.querySelector("svg use")?.getAttribute("href"))).toEqual([
      "#rp-icon-lock",
      "#rp-icon-hazard",
      "#rp-icon-loot-safe",
    ]);
    for (const row of rows) expect(row.querySelector("svg:has(use)")?.getAttribute("aria-hidden")).toBe("true");
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll("#rp-icon-sprite symbol#rp-icon-lock")).toHaveLength(1);
  });

  it("renders the icon the same on the server, before the sprite exists", () => {
    expect(renderToString(<LayerIcon layerId="switches" />)).toContain('href="#rp-icon-switch"');
  });
});
