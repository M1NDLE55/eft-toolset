import L from "leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BADGE_PATHS, ICON_ART, ICON_IDS, type IconId } from "@/app/lib/raid-planner/layer-icon-art";
import {
  ensureLayerIconSprite,
  glyphColor,
  hazardIconId,
  iconSymbolId,
  layerIconId,
  layerIconSprite,
} from "@/app/lib/raid-planner/layer-icons";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { buildLayer } from "@/app/lib/raid-planner/layers";
import { getMapCRS } from "@/app/lib/raid-planner/coords";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import type { MapDetails } from "@/app/lib/types/raidPlanner";

const at = (x: number, z: number) => ({ x, y: 0, z });

const LOOT_TYPES = ICON_IDS.filter((id) => id.startsWith("loot-") && id !== "loot-container").map((id) =>
  id.slice("loot-".length)
);

/** A map with something on every layer: every known loot type, plus one this app has never seen. */
function everyLayerDetails(): MapDetails {
  return {
    key: "customs",
    players: null,
    raidDuration: null,
    extracts: (["pmc", "scav", "shared"] as const).map((faction, index) => ({
      id: faction,
      name: `${faction} exit`,
      faction,
      position: at(index * 10, 0),
      outline: [],
      top: null,
      bottom: null,
    })),
    transits: [{ id: "t", description: "To Factory", position: at(5, 5) }],
    spawns: (["pmc", "scav", "sniper", "boss", "raider"] as const).map((kind, index) => ({
      kind,
      zoneName: null,
      position: at(index * 20, 20),
    })),
    locks: [{ lockType: "door", needsPower: false, position: at(1, 1), keyName: "Dorm room 114 key" }],
    hazards: [
      { name: "Minefield", hazardType: "minefield", position: at(50, 50), outline: [], top: null, bottom: null },
      { name: "Sniper zone", hazardType: "sniper", position: at(150, 50), outline: [at(140, 40), at(160, 40), at(160, 60)], top: null, bottom: null },
      { name: "Hazard", position: at(250, 50), outline: [], top: null, bottom: null },
    ],
    lootContainers: [...LOOT_TYPES, "mystery-crate"].map((typeId, index) => ({
      typeId,
      typeName: typeId,
      position: at(index * 30, 100),
    })),
    switches: [{ id: "s", name: "Power switch", position: at(2, 2) }],
    stationaryWeapons: [{ name: "AGS", position: at(3, 3) }],
  };
}

const customs = getMapConfig("customs")!;

function layerIds() {
  return getLayerGroups(everyLayerDetails(), customs).flatMap((group) => group.options.map((option) => option.id));
}

describe("layer icons", () => {
  it("has artwork and a badge shape for every icon", () => {
    for (const id of ICON_IDS) {
      expect(ICON_ART[id], id).toBeDefined();
      expect(ICON_ART[id].glyph.trim(), id).not.toBe("");
      expect(BADGE_PATHS[ICON_ART[id].shape], id).toBeTruthy();
    }
  });

  it("draws a different glyph for every icon", () => {
    const glyphs = new Map<string, IconId>();
    for (const id of ICON_IDS) {
      const glyph = ICON_ART[id].glyph;
      expect(glyphs.get(glyph), `${id} reuses ${glyphs.get(glyph)}'s glyph`).toBeUndefined();
      glyphs.set(glyph, id);
    }
  });

  it("gives every layer the panel can list its own icon", () => {
    const ids = layerIds();
    expect(ids).toEqual(expect.arrayContaining(["labels", "extracts:scav", "transits", "spawns:raider", "hazards", "loot:mystery-crate"]));
    const icons = ids.map(layerIconId);
    for (const icon of icons) expect(ICON_IDS).toContain(icon);
    expect(layerIconId("loot:mystery-crate")).toBe("loot-container");
    const known = ids.filter((id) => id !== "loot:mystery-crate");
    expect(new Set(known.map(layerIconId)).size).toBe(known.length);
  });

  it("picks hazard icons by hazard type", () => {
    expect(hazardIconId("minefield")).toBe("hazard-minefield");
    expect(hazardIconId("sniper")).toBe("hazard-sniper");
    expect(hazardIconId("hazard")).toBe("hazard");
    expect(hazardIconId(undefined)).toBe("hazard");
  });

  it("picks a glyph colour that contrasts with the badge", () => {
    expect(glyphColor("#f0e0a0")).toBe("#111111");
    expect(glyphColor("#402020")).toBe("#f7f1e3");
  });

  it("builds a sprite with one symbol per icon", () => {
    const host = document.createElement("div");
    host.innerHTML = layerIconSprite();
    const ids = Array.from(host.querySelectorAll("symbol"), (symbol) => symbol.id);
    expect(ids).toEqual(ICON_IDS.map(iconSymbolId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adds the sprite to the page only once", () => {
    ensureLayerIconSprite();
    ensureLayerIconSprite();
    expect(document.querySelectorAll("#rp-icon-sprite")).toHaveLength(1);
  });
});

/** The symbol a marker's badge points at, or null for anything that is not an icon badge. */
function badgeSymbol(layer: L.Layer): string | null {
  if (!(layer instanceof L.Marker)) return null;
  const { className, html } = layer.options.icon!.options as L.DivIconOptions;
  if (className !== "rp-icon-wrap" || typeof html !== "string") return null;
  return /<use href="#([^"]+)"/.exec(html)?.[1] ?? null;
}

describe("layer markers", () => {
  const details = everyLayerDetails();
  const context = { config: customs, details };

  it.each(["locks", "switches", "stationary", ...LOOT_TYPES.map((type) => `loot:${type}`), "loot:mystery-crate"])(
    "draws %s as icon badges",
    (id) => {
      const layers = buildLayer(id, context)!.group.getLayers();
      expect(layers.length).toBeGreaterThan(0);
      for (const layer of layers) expect(badgeSymbol(layer)).toBe(iconSymbolId(layerIconId(id)));
    }
  );

  it("marks each hazard with a badge for its type and keeps zones outlined", () => {
    const layers = buildLayer("hazards", context)!.group.getLayers();
    expect(layers.map(badgeSymbol).filter(Boolean)).toEqual([
      "rp-icon-hazard-minefield",
      "rp-icon-hazard-sniper",
      "rp-icon-hazard",
    ]);
    const zones = layers.filter((layer) => layer instanceof L.Polygon);
    expect(zones).toHaveLength(1);
    expect((zones[0] as L.Polygon).options.interactive).toBe(false);
  });
});

describe("crowded badges", () => {
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    container?.remove();
    vi.unstubAllGlobals();
  });

  it("shrinks a badge that would cover one already placed, and lets apart ones keep their glyph", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    container = document.createElement("div");
    document.body.append(container);
    const map = L.map(container, { crs: getMapCRS(customs), minZoom: customs.minZoom, zoomAnimation: false }).setView([0, 0], customs.minZoom);
    const details = {
      ...everyLayerDetails(),
      lootContainers: [
        { typeId: "safe", typeName: "Safe", position: at(0, 0) },
        { typeId: "safe", typeName: "Safe", position: at(0.1, 0) },
        { typeId: "safe", typeName: "Safe", position: at(2000, 2000) },
      ],
    };
    buildLayer("loot:safe", { config: customs, details })!.group.addTo(map);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const badges = Array.from(container.querySelectorAll(".rp-icon-wrap"));
    expect(badges.map((badge) => badge.classList.contains("rp-icon--compact"))).toEqual([false, true, false]);
    expect(badges[0].getAttribute("aria-label")).toBe("Safe");
    expect(container.querySelector<HTMLElement>(".leaflet-marker-pane")!.style.getPropertyValue("--rp-icon-size")).toBe("18px");
    map.remove();
  });

  it("lets the same layer keep its glyphs whatever order layers were shown in", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    container = document.createElement("div");
    document.body.append(container);
    const map = L.map(container, { crs: getMapCRS(customs), minZoom: customs.minZoom, zoomAnimation: false }).setView([0, 0], customs.minZoom);
    const details = {
      ...everyLayerDetails(),
      locks: [{ ...everyLayerDetails().locks[0], position: at(0, 0) }],
      lootContainers: [{ typeId: "safe", typeName: "Safe", position: at(0.1, 0) }],
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    const compactLabels = () =>
      Array.from(container!.querySelectorAll(".rp-icon--compact"), (badge) => badge.getAttribute("aria-label"));

    const loot = buildLayer("loot:safe", { config: customs, details })!.group.addTo(map);
    const locks = buildLayer("locks", { config: customs, details })!.group.addTo(map);
    await settle();
    expect(compactLabels()).toEqual(["Safe"]);

    // Showing the lock layer again puts it last in the map's layer order, but it still wins the spot.
    locks.remove();
    locks.addTo(map);
    await settle();
    expect(compactLabels()).toEqual(["Safe"]);
    loot.remove();
    map.remove();
  });

  it("keeps badges under place names, exit pills and plan markers", () => {
    const [marker] = buildLayer("loot:safe", { config: customs, details: everyLayerDetails() })!.group.getLayers() as L.Marker[];
    const [pill] = buildLayer("extracts:pmc", { config: customs, details: everyLayerDetails() })!.group
      .getLayers()
      .filter((layer) => layer instanceof L.Marker) as L.Marker[];
    expect(marker.options.zIndexOffset).toBeLessThan(-1000);
    expect(pill.options.zIndexOffset ?? 0).toBe(0);
    expect(marker.options.riseOnHover).toBe(true);
    expect(marker.options.zIndexOffset! + marker.options.riseOffset!).toBeGreaterThan(0);
  });
});
