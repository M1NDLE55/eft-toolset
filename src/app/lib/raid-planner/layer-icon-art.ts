/**
 * Artwork for the map layer icons: each glyph is SVG markup on a 24×24 grid,
 * drawn in `currentColor`, that sits centred on a badge shape.
 *
 * All artwork is original. Glyphs inherit fill="none", stroke="currentColor",
 * stroke-width 2 and round caps/joins from the wrapping group; solid parts set
 * `fill` explicitly. Badge shapes group the layer families so that the icons
 * can be told apart without colour:
 * - square: loot containers
 * - shield: locks
 * - circle: switches and stationary weapons
 * - triangle: hazards
 * - pill: extracts and transits
 * - hexagon: spawns
 * - diamond: place names
 */

export type BadgeShape = "circle" | "square" | "diamond" | "hexagon" | "shield" | "triangle" | "pill";

export const ICON_IDS = [
  // Panel / legend only (these layers draw pills or areas on the map)
  "labels",
  "extract-pmc",
  "extract-scav",
  "extract-shared",
  "transit",
  "spawn-pmc",
  "spawn-scav",
  "spawn-sniper",
  "spawn-boss",
  "spawn-raider",
  // Points on the map
  "lock",
  "switch",
  "stationary",
  "hazard",
  "hazard-minefield",
  "hazard-sniper",
  // Loot containers, by tarkov.dev normalizedName
  "loot-duffle-bag",
  "loot-drawer",
  "loot-weapon-box",
  "loot-toolbox",
  "loot-wooden-crate",
  "loot-jacket",
  "loot-pc-block",
  "loot-cash-register",
  "loot-grenade-box",
  "loot-dead-scav",
  "loot-buried-barrel-cache",
  "loot-medbag",
  "loot-pmc-body",
  "loot-ground-cache",
  "loot-technical-supply-crate",
  "loot-wooden-ammo-box",
  "loot-medcase",
  "loot-plastic-suitcase",
  "loot-safe",
  "loot-ration-supply-crate",
  "loot-medical-supply-crate",
  "loot-civilian-body",
  "loot-bank-safe",
  "loot-bank-cash-register",
  "loot-scav-body",
  "loot-lab-technician-body",
  "loot-shturmans-stash",
  /** A loot container type this list does not know yet. */
  "loot-container",
] as const;

export type IconId = (typeof ICON_IDS)[number];

export interface IconArt {
  /** Badge outline the glyph sits on; shapes group layer families so colour is not needed to tell them apart. */
  shape: BadgeShape;
  /** Inner SVG markup (paths etc.) on a 24×24 grid, stroke/fill in currentColor. No ids, scripts or styles. */
  glyph: string;
}

/** Solid fill, no stroke. */
const S = 'fill="currentColor" stroke="none"';

/** Supply crate: a plain box; its marking fills the middle (centre 12,12). */
const CRATE = '<rect x="3" y="3" width="18" height="18" rx="1.5"/>';

/** A body lying down along the bottom; its marking goes above it. */
const BODY = `<circle cx="4.5" cy="17.5" r="2.5" ${S}/><path d="M11 17.5h9.5" stroke-width="4.5"/>`;

/** Head and shoulders for the spawn icons; the head is drawn per icon around 12,9. */
const SHOULDERS = '<path d="M4.5 21.5a7.5 6 0 0 1 15 0"/>';

export const ICON_ART: Record<IconId, IconArt> = {
  // ---- Panel / legend ----
  labels: {
    shape: "diamond",
    glyph: '<path d="M8 17.5L12 6.5l4 11M9.5 13.5h5" stroke-width="2.25"/>',
  },
  "extract-pmc": {
    shape: "pill",
    // Helmet, then an exit arrow.
    glyph: `<path ${S} d="M1.5 13a4.5 4.5 0 0 1 9 0h1.5v2H0v-2z"/><path d="M14 12h8M18.5 8.5L22 12l-3.5 3.5"/>`,
  },
  "extract-scav": {
    shape: "pill",
    // Balaclava (head with two eye holes), then an exit arrow.
    glyph: `<path ${S} fill-rule="evenodd" d="M5.5 7a5 5 0 1 1 0 10a5 5 0 1 1 0-10zM3.7 9.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM7.3 9.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8z"/><path d="M14 12h8M18.5 8.5L22 12l-3.5 3.5"/>`,
  },
  "extract-shared": {
    shape: "pill",
    // Two heads together, then an exit arrow.
    glyph: `<circle cx="3.5" cy="10" r="2.6" ${S}/><circle cx="9" cy="14" r="2.6" ${S}/><path d="M14 12h8M18.5 8.5L22 12l-3.5 3.5"/>`,
  },
  transit: {
    shape: "pill",
    // Two-way arrows.
    glyph: '<path d="M3 8.5h17M16.5 5L20 8.5 16.5 12M21 15.5H4M7.5 12L4 15.5 7.5 19"/>',
  },
  "spawn-pmc": {
    shape: "hexagon",
    // Helmeted head and shoulders.
    glyph: `<path ${S} d="M7 9.5a5 5 0 0 1 10 0h1.5v2h-13v-2z"/><path d="M8.5 13a3.5 2.5 0 0 0 7 0"/>${SHOULDERS}`,
  },
  "spawn-scav": {
    shape: "hexagon",
    // Balaclava head and shoulders.
    glyph: `<path ${S} fill-rule="evenodd" d="M12 3.5a5 5 0 1 1 0 10a5 5 0 1 1 0-10zM10.2 6.4a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM13.8 6.4a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8z"/>${SHOULDERS}`,
  },
  "spawn-sniper": {
    shape: "hexagon",
    // A scope reticle: ring, four ticks and a centre dot.
    glyph: `<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.6" ${S}/>`,
  },
  "spawn-boss": {
    shape: "hexagon",
    // Crowned head and shoulders.
    glyph: `<path ${S} d="M7 9.5L6.5 3.5l3 2.5L12 2.5 14.5 6l3-2.5-.5 6z"/><circle cx="12" cy="13.5" r="2.6" ${S}/>${'<path d="M5.5 21.5a6.5 5 0 0 1 13 0"/>'}`,
  },
  "spawn-raider": {
    shape: "hexagon",
    // Full helmet with a wide visor slot, and shoulders.
    glyph: `<path ${S} fill-rule="evenodd" d="M12 3a5.5 5.5 0 0 1 5.5 5.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8.5A5.5 5.5 0 0 1 12 3zM8 8h8v2.4H8z"/>${SHOULDERS}`,
  },

  // ---- Points ----
  lock: {
    shape: "shield",
    // Padlock with a keyhole.
    glyph: `<path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/><path ${S} fill-rule="evenodd" d="M7.5 10.5h9a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1zM12 12.5a1.6 1.6 0 0 0-.8 3V18h1.6v-2.5a1.6 1.6 0 0 0-.8-3z"/>`,
  },
  switch: {
    shape: "circle",
    // Lever on a base plate.
    glyph: `<rect x="5" y="15" width="14" height="5" rx="1.5"/><path d="M11 15l5-8.5"/><circle cx="16.5" cy="6" r="2.6" ${S}/>`,
  },
  stationary: {
    shape: "circle",
    // Mounted gun on a tripod.
    glyph: `<path ${S} d="M3.5 8.5h11a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-11z"/><path d="M15 10.5h6M9.5 13l-4 7M9.5 13l4 7"/>`,
  },
  hazard: {
    shape: "triangle",
    // Exclamation mark.
    glyph: `<path d="M12 9v6" stroke-width="2.5"/><circle cx="12" cy="19" r="1.5" ${S}/>`,
  },
  "hazard-minefield": {
    shape: "triangle",
    // Anti-personnel mine: dome on a plate with a trigger.
    glyph: `<path ${S} d="M6 17.5a6 4.5 0 0 1 12 0h1.5v2.5h-15v-2.5z"/><path d="M12 13v-2.5M10 10.5h4"/>`,
  },
  "hazard-sniper": {
    shape: "triangle",
    // Crosshair.
    glyph: `<circle cx="12" cy="16" r="4.5"/><path d="M12 9.5v3M12 19.5v3M5.5 16h3M15.5 16h3"/><circle cx="12" cy="16" r="1" ${S}/>`,
  },

  // ---- Loot containers ----
  "loot-duffle-bag": {
    shape: "square",
    // Long soft bag with round ends and a carry strap.
    glyph: '<rect x="2.5" y="9" width="19" height="11" rx="5.5"/><path d="M8 9.5v10M16 9.5v10M9 9V7.5a3 3 0 0 1 6 0V9"/>',
  },
  "loot-drawer": {
    shape: "square",
    // Chest of three drawers with handles.
    glyph: '<rect x="4" y="2.5" width="16" height="19" rx="1.5"/><path d="M4 9h16M4 15h16M10 5.75h4M10 12h4M10 18.25h4"/>',
  },
  "loot-weapon-box": {
    shape: "square",
    // Long case with a rifle inside.
    glyph: `<rect x="2" y="6" width="20" height="12" rx="1.5"/><path ${S} d="M4.5 9.5h15V12h-6l-.8 3.5h-2.2l.6-3.5H7.8l-1 2H4.5z"/>`,
  },
  "loot-toolbox": {
    shape: "square",
    // Wide box with a large carry handle and a lid seam.
    glyph: '<rect x="2.5" y="10" width="19" height="10" rx="1.5"/><path d="M7 10V6h10v4M2.5 14h19"/>',
  },
  "loot-wooden-crate": {
    shape: "square",
    // Crate with an inner frame and a diagonal brace.
    glyph: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M7.5 7.5h9v9h-9zM7.5 16.5l9-9"/>',
  },
  "loot-jacket": {
    shape: "square",
    // Jacket with a zip.
    glyph: '<path d="M8.5 3L12 5.5 15.5 3 21 6l-2 5.5-2-1V21H7V10.5l-2 1L3 6z"/><path d="M12 5.5V21"/>',
  },
  "loot-pc-block": {
    shape: "square",
    // PC tower with drive bays and a power button.
    glyph: `<rect x="6" y="2" width="12" height="20" rx="1.5"/><path d="M9 6h6M9 9.5h6"/><circle cx="12" cy="17" r="1.6" ${S}/>`,
  },
  "loot-cash-register": {
    shape: "square",
    // Till: solid display on top, a row of keys, cash drawer.
    glyph: `<rect x="7" y="2.5" width="10" height="4" rx="1" ${S}/><path d="M4 15V9.5h16V15"/><circle cx="8" cy="12.25" r="1.1" ${S}/><circle cx="12" cy="12.25" r="1.1" ${S}/><circle cx="16" cy="12.25" r="1.1" ${S}/><rect x="2.5" y="15" width="19" height="6" rx="1"/><path d="M10 18h4"/>`,
  },
  "loot-grenade-box": {
    shape: "square",
    // Supply crate marked with a grenade.
    glyph: `${CRATE}<circle cx="11.5" cy="14" r="4" ${S}/><path ${S} d="M10 7h3v3.5h-3z"/><path d="M13.5 7.5h1.5l1.5 3"/>`,
  },
  "loot-dead-scav": {
    shape: "square",
    // A body with a cross mark above it.
    glyph: `${BODY}<path d="M10 3.5l6 6M16 3.5l-6 6" stroke-width="2.5"/>`,
  },
  "loot-buried-barrel-cache": {
    shape: "square",
    // Solid barrel with hoops standing out of the ground.
    glyph: `<path ${S} fill-rule="evenodd" d="M7.5 3h9c1.2 4.5 1.2 8.5 0 12.5h-9c-1.2-4-1.2-8 0-12.5zM7.6 6.6h8.8V8H7.6zM7.6 10.6h8.8V12H7.6z"/><path d="M2 17.5h20M4.5 21h3M10.5 21h3M16.5 21h3"/>`,
  },
  "loot-medbag": {
    shape: "square",
    // Soft doctor's bag with an arched handle and a cross.
    glyph: `<path d="M3 11a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8.5 8a3.5 3.5 0 0 1 7 0"/><path ${S} d="M10.75 11h2.5v2.25h2.25v2.5h-2.25V18h-2.5v-2.25H8.5v-2.5h2.25z"/>`,
  },
  "loot-pmc-body": {
    shape: "square",
    // A body with a helmet above it.
    glyph: `${BODY}<path ${S} d="M8 10.5a5 5 0 0 1 10 0h1.5v2h-13v-2z"/>`,
  },
  "loot-ground-cache": {
    shape: "square",
    // Mound of earth with a shovel stuck in it.
    glyph: `<path ${S} d="M2 21c1.5-4.5 5.5-7 10-7s8.5 2.5 10 7z"/><path d="M13.5 12L17.5 4M15.7 3.1l3.6 1.8"/>`,
  },
  "loot-technical-supply-crate": {
    shape: "square",
    // Supply crate marked with a cog.
    glyph: `${CRATE}<path ${S} fill-rule="evenodd" d="M16.35 10.51L18.15 10.63V13.37L16.35 13.49L16.13 14.02L17.32 15.38L15.38 17.32L14.02 16.13L13.49 16.35L13.37 18.15H10.63L10.51 16.35L9.98 16.13L8.62 17.32L6.68 15.38L7.87 14.02L7.65 13.49L5.85 13.37V10.63L7.65 10.51L7.87 9.98L6.68 8.62L8.62 6.68L9.98 7.87L10.51 7.65L10.63 5.85H13.37L13.49 7.65L14.02 7.87L15.38 6.68L17.32 8.62L16.13 9.98zM12 9.9a2.1 2.1 0 1 0 0 4.2a2.1 2.1 0 1 0 0-4.2z"/>`,
  },
  "loot-wooden-ammo-box": {
    shape: "square",
    // Supply crate marked with two cartridges.
    glyph: `${CRATE}<path ${S} d="M7 18v-6.5c0-3 .9-5 1.75-6.5.85 1.5 1.75 3.5 1.75 6.5V18zM13.5 18v-6.5c0-3 .9-5 1.75-6.5.85 1.5 1.75 3.5 1.75 6.5V18z"/>`,
  },
  "loot-medcase": {
    shape: "square",
    // Solid hard case with a cut-out cross and a small handle.
    glyph: `<path d="M9.5 6.5V4h5v2.5"/><path ${S} fill-rule="evenodd" d="M4.5 6.5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2zM10.6 9.5v2.9H7.7v2.7h2.9V18h2.8v-2.9h2.9v-2.7h-2.9V9.5z"/>`,
  },
  "loot-plastic-suitcase": {
    shape: "square",
    // Upright hard-shell suitcase on wheels, with a pull-up handle and ribs.
    glyph: `<rect x="5.5" y="8.5" width="13" height="11" rx="2"/><path d="M10 8.5V3h4v5.5M9.5 11.5v5M14.5 11.5v5"/><circle cx="8.5" cy="21.5" r="1.3" ${S}/><circle cx="15.5" cy="21.5" r="1.3" ${S}/>`,
  },
  "loot-safe": {
    shape: "square",
    // Safe with a dial, on feet.
    glyph: `<rect x="3" y="3" width="18" height="16" rx="2"/><circle cx="12" cy="11" r="4"/><circle cx="12" cy="11" r="1.2" ${S}/><path d="M6.5 19v2.5M17.5 19v2.5"/>`,
  },
  "loot-ration-supply-crate": {
    shape: "square",
    // Supply crate marked with a fork.
    glyph: `${CRATE}<path d="M8.5 6.5v4.5a3.5 3.5 0 0 0 7 0V6.5M12 6.5v11"/>`,
  },
  "loot-medical-supply-crate": {
    shape: "square",
    // Supply crate marked with a cross.
    glyph: `${CRATE}<path ${S} d="M10 6.5h4v3.5h3.5v4H14v3.5h-4V14H6.5v-4H10z"/>`,
  },
  "loot-civilian-body": {
    shape: "square",
    // A body with a necktie above it.
    glyph: `${BODY}<path ${S} d="M10.8 2.5h4.4l-1.1 2.3 1.6 6-2.7 2.2-2.7-2.2 1.6-6z"/>`,
  },
  "loot-bank-safe": {
    shape: "square",
    // Safe under a bank's pediment roof.
    glyph: `<path d="M3 8L12 3.5 21 8z"/><rect x="4" y="10.5" width="16" height="10.5" rx="1.5"/><circle cx="12" cy="15.75" r="2.5"/>`,
  },
  "loot-bank-cash-register": {
    shape: "square",
    // Stack of banknotes.
    glyph: '<rect x="2" y="6" width="17" height="10.5" rx="1"/><circle cx="10.5" cy="11.25" r="2.5"/><path d="M5 19.5h17V9.5"/>',
  },
  "loot-scav-body": {
    shape: "square",
    // A body with a balaclava head above it.
    glyph: `${BODY}<path ${S} fill-rule="evenodd" d="M13 2.5a4.75 4.75 0 1 1 0 9.5a4.75 4.75 0 1 1 0-9.5zM11.3 5.3a1.35 1.35 0 1 0 0 2.7a1.35 1.35 0 1 0 0-2.7zM14.7 5.3a1.35 1.35 0 1 0 0 2.7a1.35 1.35 0 1 0 0-2.7z"/>`,
  },
  "loot-lab-technician-body": {
    shape: "square",
    // A body with a lab flask above it.
    glyph: `${BODY}<path d="M10.5 2.5h5M11.75 3v3.5L8 11.5h10l-3.75-5V3"/><path ${S} d="M9.6 9.5h6.8l1.6 2H8z"/>`,
  },
  "loot-shturmans-stash": {
    shape: "square",
    // Treasure chest: solid domed lid, open body and a hanging lock.
    glyph: `<path ${S} d="M2 11V9a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v2z"/><path d="M3 13.5V20h18v-6.5"/><rect x="10" y="10" width="4" height="5.5" rx="1" ${S}/>`,
  },
  "loot-container": {
    shape: "square",
    // Generic closed box (isometric).
    glyph: '<path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/><path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5"/>',
  },
};

/**
 * Badge outlines as SVG path data on a 32×32 grid (the badge is drawn larger
 * than the 24×24 glyph, which is placed at 4,4).
 */
export const BADGE_PATHS: Record<BadgeShape, string> = {
  circle: "M16 2a14 14 0 1 1 0 28a14 14 0 1 1 0-28z",
  square: "M6 2h20a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z",
  diamond: "M16 1l15 15-15 15L1 16z",
  hexagon: "M16 1.5l12.5 7.25v14.5L16 30.5 3.5 23.25V8.75z",
  shield: "M16 1.5l12 4.5v9c0 7.5-5.2 13-12 15.5C9.2 28 4 22.5 4 15V6z",
  triangle: "M16 2l15 27H1z",
  pill: "M9 6h14a10 10 0 0 1 0 20H9a10 10 0 0 1 0-20z",
};
