import { BADGE_PATHS, ICON_ART, ICON_IDS, type IconId } from "./layer-icon-art";

/** Layer colours, shared by the map markers and the layer panel. */
export const COLORS = {
  pmc: "#7da05f",
  scav: "#c08a3e",
  shared: "#5f8aa0",
  transit: "#8a6fa0",
  sniper: "#a05050",
  boss: "#c04848",
  raider: "#8a8a8a",
  labels: "#d8cfb8",
  lock: "#d2b75a",
  hazard: "#c0504a",
  switch: "#5fa8c8",
  stationary: "#b9a27a",
} as const;

// Loot containers are coloured by what they hold, so several enabled types stay apart.
const LOOT_FAMILIES: { color: string; types: string[] }[] = [
  { color: "#e0bb4a", types: ["safe", "bank-safe", "cash-register", "bank-cash-register"] },
  { color: "#54b0b8", types: ["pc-block", "technical-supply-crate", "toolbox"] },
  { color: "#e07a86", types: ["medbag", "medcase", "medical-supply-crate"] },
  { color: "#a3b458", types: ["weapon-box", "grenade-box", "wooden-ammo-box"] },
  { color: "#b8b8b8", types: ["dead-scav", "pmc-body", "civilian-body", "scav-body", "lab-technician-body"] },
  { color: "#c98a52", types: ["buried-barrel-cache", "ground-cache", "shturmans-stash"] },
];
const LOOT_COLOR = "#d6c08e";

const ICON_COLORS: Partial<Record<IconId, string>> = {
  labels: COLORS.labels,
  "extract-pmc": COLORS.pmc,
  "extract-scav": COLORS.scav,
  "extract-shared": COLORS.shared,
  transit: COLORS.transit,
  "spawn-pmc": COLORS.pmc,
  "spawn-scav": COLORS.scav,
  "spawn-sniper": COLORS.sniper,
  "spawn-boss": COLORS.boss,
  "spawn-raider": COLORS.raider,
  lock: COLORS.lock,
  switch: COLORS.switch,
  stationary: COLORS.stationary,
  hazard: COLORS.hazard,
  "hazard-minefield": COLORS.hazard,
  "hazard-sniper": COLORS.hazard,
  ...Object.fromEntries(
    LOOT_FAMILIES.flatMap(({ color, types }) => types.map((type) => [`loot-${type}`, color]))
  ),
};

export function iconColor(id: IconId): string {
  return ICON_COLORS[id] ?? LOOT_COLOR;
}

const LAYER_ICONS: Record<string, IconId> = {
  labels: "labels",
  "extracts:pmc": "extract-pmc",
  "extracts:scav": "extract-scav",
  "extracts:shared": "extract-shared",
  transits: "transit",
  "spawns:pmc": "spawn-pmc",
  "spawns:scav": "spawn-scav",
  "spawns:sniper": "spawn-sniper",
  "spawns:boss": "spawn-boss",
  "spawns:raider": "spawn-raider",
  locks: "lock",
  switches: "switch",
  stationary: "stationary",
  hazards: "hazard",
};

const KNOWN_ICONS = new Set<string>(ICON_IDS);

/** A loot type's icon; types added upstream after this list get the generic container. */
export function lootIconId(typeId: string): IconId {
  const id = `loot-${typeId}`;
  return KNOWN_ICONS.has(id) ? (id as IconId) : "loot-container";
}

/** The icon for a layer id as the layer panel lists it. */
export function layerIconId(layerId: string): IconId {
  if (layerId.startsWith("loot:")) return lootIconId(layerId.slice("loot:".length));
  return LAYER_ICONS[layerId] ?? "loot-container";
}

const HAZARD_ICONS: Record<string, IconId> = {
  minefield: "hazard-minefield",
  sniper: "hazard-sniper",
};

export function hazardIconId(hazardType: string | null | undefined): IconId {
  return (hazardType && HAZARD_ICONS[hazardType]) || "hazard";
}

const DARK = "#111111";
const LIGHT = "#f7f1e3";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The dark or light glyph colour with more contrast against the badge. */
export function glyphColor(badge: string): string {
  const badgeLuminance = luminance(badge);
  const onDark = (luminance(LIGHT) + 0.05) / (badgeLuminance + 0.05);
  const onLight = (badgeLuminance + 0.05) / (luminance(DARK) + 0.05);
  return onLight >= onDark ? DARK : LIGHT;
}

export const ICON_SPRITE_ID = "rp-icon-sprite";

export function iconSymbolId(id: IconId) {
  return `rp-icon-${id}`;
}

/** One <symbol> per icon: the badge in the layer colour with a dark edge, and the glyph on top. */
export function layerIconSprite(): string {
  const symbols = ICON_IDS.map((id) => {
    const { shape, glyph } = ICON_ART[id];
    const color = iconColor(id);
    return (
      `<symbol id="${iconSymbolId(id)}" viewBox="0 0 32 32">` +
      `<path d="${BADGE_PATHS[shape]}" fill="${color}" stroke="${DARK}" stroke-width="2" stroke-linejoin="round"/>` +
      `<g transform="translate(4 4)" color="${glyphColor(color)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
      `</symbol>`
    );
  });
  return `<svg id="${ICON_SPRITE_ID}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden">${symbols.join("")}</svg>`;
}

/** Adds the icon sprite to the page once; markers and the layer panel point at its symbols. */
export function ensureLayerIconSprite(doc: Document = document) {
  if (doc.getElementById(ICON_SPRITE_ID)) return;
  doc.body.insertAdjacentHTML("beforeend", layerIconSprite());
}

export function layerIconMarkup(id: IconId): string {
  return `<svg class="rp-icon-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="#${iconSymbolId(id)}"/></svg>`;
}
