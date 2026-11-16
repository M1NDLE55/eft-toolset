import type { Metadata } from "next";
import Link from "next/link";
import { PlansHome } from "@/app/components/raid-planner/plans-home";
import { ToolAbout } from "@/app/components/seo/tool-about";
import { JsonLd, faqPage, webApplication } from "@/app/components/seo/json-ld";
import { RAID_PLANNER_DESCRIPTION, RAID_PLANNER_TITLE } from "@/app/lib/seo/site-copy";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

export const metadata: Metadata = {
  title: RAID_PLANNER_TITLE,
  description: RAID_PLANNER_DESCRIPTION,
  alternates: { canonical: "/raid-planner" },
};

const FEATURES = [
  {
    title: "Interactive maps of every location",
    text: "Pan and zoom clean maps of every Tarkov location, with each floor and level, including Icebreaker's decks.",
  },
  {
    title: "Extracts, spawns, bosses and keys",
    text: "Toggle layers for PMC and Scav extracts, transits, spawns, boss spawns, locked doors and their keys, hazards and loot containers.",
  },
  {
    title: "Draw your raid",
    text: "Add routes, arrows, waypoints and notes on each level, measure distances, and see the total route length. Undo and redo as you go.",
  },
  {
    title: "Share with your squad",
    text: "Send a plan as a link or export it to a file. Plans are saved in your browser, no account needed.",
  },
];

const FAQ = [
  {
    question: "What is a Tarkov raid planner?",
    answer:
      "A raid planner lets you draw your route, extracts and callouts on a map before a raid, so your squad knows the plan. Pick a map, draw on it, and share the link.",
  },
  {
    question: "Which Tarkov maps are included?",
    answer: `All of them: ${mapConfigs.map((map) => map.name).join(", ")}.`,
  },
  {
    question: "Does the map show extracts and boss spawns?",
    answer:
      "Yes. Each map has layers for PMC and Scav extracts, transits, spawns, bosses, keys and locks, hazards and loot, with names on the map. Each map page also lists its extracts, bosses and keys.",
  },
  {
    question: "Is the raid planner free?",
    answer: "Yes. It's free, needs no account, and works on desktop and mobile.",
  },
];

export default function Page() {
  return (
    <>
      <JsonLd data={webApplication({ name: "EFT Toolset Raid Planner", path: "/raid-planner", description: RAID_PLANNER_DESCRIPTION })} />
      <JsonLd data={faqPage(FAQ)} />
      <PlansHome />
      <div className="flex justify-center px-4 pb-12">
        <div className="w-full max-w-4xl">
          <ToolAbout
            id="about-raid-planner"
            title="Interactive Tarkov maps and raid planner"
            intro={
              <p>
                Plan Escape from Tarkov raids on interactive maps that show every extract, transit, spawn, boss, key and
                loot container. Draw your route and callouts, then share the plan with your squad as a link.
              </p>
            }
            features={FEATURES}
            faq={FAQ}
          >
            <nav aria-label="Tarkov maps" className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">Tarkov maps</h2>
              <ul className="flex flex-wrap gap-2">
                {mapConfigs.map((map) => (
                  <li key={map.key}>
                    <Link
                      href={`/raid-planner/map/${map.key}`}
                      className="inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
                    >
                      {map.name} map
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </ToolAbout>
        </div>
      </div>
    </>
  );
}
