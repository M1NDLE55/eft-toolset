import type { Metadata } from "@/app/lib/seo/metadata";
import { PlansHome } from "@/app/components/raid-planner/plans-home";
import { FaqSection } from "@/app/components/seo/faq-section";
import { JsonLd, faqPage, webApplication } from "@/app/components/seo/json-ld";
import { RAID_PLANNER_DESCRIPTION, RAID_PLANNER_TITLE } from "@/app/lib/seo/site-copy";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

export const RAID_PLANNER_PAGE_METADATA: Metadata = {
  title: RAID_PLANNER_TITLE,
  description: RAID_PLANNER_DESCRIPTION,
  alternates: { canonical: "/raid-planner" },
};

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

export function RaidPlannerPage() {
  return (
    <>
      <JsonLd data={webApplication({ name: "EFT Toolset Raid Planner", path: "/raid-planner", description: RAID_PLANNER_DESCRIPTION })} />
      <JsonLd data={faqPage(FAQ)} />
      <PlansHome />
      <div className="flex justify-center px-4 pb-12">
        <div className="w-full max-w-4xl">
          <FaqSection id="raid-planner-faq" title="Raid planner questions" entries={FAQ} />
        </div>
      </div>
    </>
  );
}
