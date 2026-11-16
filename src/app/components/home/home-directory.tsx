import Link from "next/link";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

const GUIDES = [
  { href: "/item", text: "Flea market prices" },
  { href: "/flea-market/pve", text: "PVE flea prices" },
  { href: "/gun-builder/best", text: "Best weapon builds" },
  { href: "/gun-builder/gunsmith", text: "Gunsmith builds" },
  { href: "/ammo", text: "Ammo chart" },
  { href: "/keys", text: "Keys by map" },
];

const chip =
  "inline-block border border-[#1a1a1a] bg-[#0c0c0c] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]";

/**
 * Rendered on the server under every home screen: what the site offers and links to every map
 * and guide, so the home page has the same content for search engines whichever layout is picked.
 */
export function HomeDirectory() {
  return (
    <section aria-labelledby="home-directory" className="mt-10 flex w-full max-w-5xl flex-col gap-6 border-t border-[#1a1a1a] pt-8">
      <div className="flex flex-col gap-2">
        <h2 id="home-directory" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
          Escape from Tarkov tools
        </h2>
        <p className="max-w-3xl text-sm text-[#999]">
          Fast, free tools for Escape from Tarkov: live flea market and trader prices for every item, interactive maps with
          extracts, spawns, bosses and keys, a gun builder with a recoil optimiser, and a raid planner. Live tarkov.dev data
          for PVP and PVE, saved in your browser and shareable by link.
        </p>
      </div>
      <nav aria-labelledby="home-guides" className="flex flex-col gap-3">
        <h3 id="home-guides" className="text-[10px] font-bold uppercase tracking-widest text-[#777]">
          Prices, guides and charts
        </h3>
        <ul className="flex flex-wrap gap-2">
          {GUIDES.map((guide) => (
            <li key={guide.href}>
              <Link href={guide.href} className={chip}>
                {guide.text}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-labelledby="home-maps" className="flex flex-col gap-3">
        <h3 id="home-maps" className="text-[10px] font-bold uppercase tracking-widest text-[#777]">
          Interactive Tarkov maps
        </h3>
        <ul className="flex flex-wrap gap-2">
          {mapConfigs.map((map) => (
            <li key={map.key}>
              <Link href={`/raid-planner/map/${map.key}`} className={chip}>
                {map.name} map
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
