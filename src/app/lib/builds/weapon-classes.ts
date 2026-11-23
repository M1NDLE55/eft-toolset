// The weapon classes best-build pages group weapons into. No imports, so pages can use it in the
// browser without pulling in the optimiser and the data adapter.

export const WEAPON_CLASSES = [
  { name: "Assault rifles", categories: ["assault rifle"] },
  { name: "Assault carbines", categories: ["assault carbine"] },
  { name: "Submachine guns", categories: ["smg"] },
  { name: "Marksman rifles", categories: ["marksman rifle"] },
  { name: "Bolt-action rifles", categories: ["sniper rifle"] },
  { name: "Machine guns", categories: ["machinegun"] },
  { name: "Shotguns", categories: ["shotgun"] },
  { name: "Pistols", categories: ["handgun", "revolver"] },
] as const;

export type WeaponClass = (typeof WEAPON_CLASSES)[number]["name"];
