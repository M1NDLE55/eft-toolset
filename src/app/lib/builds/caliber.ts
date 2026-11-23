// Calibre names, shared by the gun builder, the ammo pages and the MCP tools. No imports, so the
// browser can use it without pulling in server code.

/** "Caliber556x45NATO" → "556x45NATO", the id other tools and filters accept. */
export function caliberId(caliber: string | null | undefined) {
  return caliber?.replace(/^Caliber/, "") || null;
}

const CALIBER_NAMES: Record<string, string> = {
  "1143x23ACP": ".45 ACP",
  "127x33": ".50 AE",
  "127x99": ".50 BMG",
  "12g": "12 gauge",
  "20g": "20 gauge",
  "366TKM": ".366 TKM",
  "40mmRU": "40mm VOG",
  "46x30": "4.6x30mm",
  "545x39": "5.45x39mm",
  "556x45NATO": "5.56x45mm NATO",
  "57x28": "5.7x28mm",
  "58x42": "5.8x42mm",
  "68x51": "6.8x51mm",
  "762x25TT": "7.62x25mm Tokarev",
  "762x35": ".300 Blackout",
  "762x51": "7.62x51mm NATO",
  "762x54R": "7.62x54mmR",
  "784x49": ".308 ME",
  "86x70": ".338 Lapua Magnum",
  "93x64": "9.3x64mm",
  "9x18PM": "9x18mm Makarov",
  "9x18PMM": "9x18mm PMM",
  "9x19PARA": "9x19mm Parabellum",
  "9x33R": ".357 Magnum",
};

/** "Caliber556x45NATO" → "5.56x45mm NATO"; unlisted ids are read as bore x case length, "762x39" → "7.62x39mm". */
export function formatCaliber(caliber: string | null | undefined) {
  const id = caliberId(caliber);
  if (!id) return null;
  const named = CALIBER_NAMES[id];
  if (named) return named;
  const match = /^(\d+)x(\d+)(.*)$/.exec(id);
  if (!match) return id;
  const [, bore, length, rawSuffix] = match;
  // Three-digit bores carry an implied decimal point: "762" is 7.62mm, "127" is 12.7mm.
  const diameter =
    bore.length === 3 ? (bore.startsWith("1") ? `${bore.slice(0, 2)}.${bore[2]}` : `${bore[0]}.${bore.slice(1)}`) : bore;
  const suffix = rawSuffix.replace(/^mm/, "");
  return `${diameter}x${length}mm${suffix ? ` ${suffix}` : ""}`;
}
