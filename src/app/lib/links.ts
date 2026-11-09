export type AppLink = {
  text: string;
  href: string;
  description: string;
};

export const appLinks: AppLink[] = [
  {
    text: "Item scanner",
    href: "/item",
    description: "Prices, slot value, and every task, barter, and craft for any item.",
  },
  {
    text: "Item groups",
    href: "/item-groups",
    description: "Watchlists of loot with live best-sell prices and totals.",
  },
  {
    text: "Gun builder",
    href: "/gun-builder",
    description: "Assemble weapons part by part and compare stats and cost.",
  },
  {
    text: "Raid planner",
    href: "/raid-planner",
    description: "Draw routes and notes on interactive maps and share them.",
  },
];
