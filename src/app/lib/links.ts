export type AppLink = {
  /** Short label for the header navigation. */
  text: string;
  /** Longer label for the home page cards. */
  title: string;
  href: string;
  description: string;
};

export const appLinks: AppLink[] = [
  {
    text: "Item prices",
    title: "Flea market prices",
    href: "/item",
    description: "Live flea and trader prices, the best place to sell, value per slot, and every task, barter and craft for any item.",
  },
  {
    text: "Maps",
    title: "Interactive maps & raid planner",
    href: "/raid-planner",
    description: "Every map with extracts, spawns, bosses and keys. Draw routes and notes and share them with your squad.",
  },
  {
    text: "Gun builder",
    title: "Gun builder",
    href: "/gun-builder",
    description: "Mod weapons part by part with live recoil, ergonomics and cost, and find the lowest recoil build.",
  },
  {
    text: "Item groups",
    title: "Item groups",
    href: "/item-groups",
    description: "Watchlists of loot with live best-sell prices and totals.",
  },
];

/** Reference pages listed in the site footer next to the main tools. */
export const guideLinks: { text: string; href: string }[] = [
  { text: "PVE flea prices", href: "/flea-market/pve" },
  { text: "Best weapon builds", href: "/gun-builder/best" },
  { text: "Gunsmith builds", href: "/gun-builder/gunsmith" },
  { text: "Ammo chart", href: "/ammo" },
  { text: "Keys by map", href: "/keys" },
];
