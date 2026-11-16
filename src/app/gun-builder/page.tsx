import type { Metadata } from "next";
import { BuildsHome } from "@/app/components/gun-builder/builds-home";
import { FaqSection } from "@/app/components/seo/faq-section";
import { JsonLd, faqPage, webApplication } from "@/app/components/seo/json-ld";
import { GUN_BUILDER_DESCRIPTION, GUN_BUILDER_TITLE } from "@/app/lib/seo/site-copy";

export const metadata: Metadata = {
  title: GUN_BUILDER_TITLE,
  description: GUN_BUILDER_DESCRIPTION,
  alternates: { canonical: "/gun-builder" },
};

const FAQ = [
  {
    question: "How do I make the lowest recoil build in Tarkov?",
    answer:
      "Create a build for the weapon, open the optimiser and choose Recoil. It searches the weapon's compatible parts for the lowest vertical recoil, and you can set a budget to keep it affordable. The ammo you pick changes recoil too.",
  },
  {
    question: "Are the gun builder prices live?",
    answer:
      "Yes. Part prices come from live tarkov.dev flea market and trader data, for PVP or PVE depending on the switch in the header.",
  },
  {
    question: "Can I share a Tarkov weapon build?",
    answer:
      "Every build has a share link. Anyone who opens it sees the build and can import it into their own gun builder.",
  },
  {
    question: "Is the gun builder free?",
    answer: "Yes. It's free, needs no account, and works on desktop and mobile.",
  },
];

export default function Page() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-10">
      <JsonLd data={webApplication({ name: "EFT Toolset Gun Builder", path: "/gun-builder", description: GUN_BUILDER_DESCRIPTION })} />
      <JsonLd data={faqPage(FAQ)} />
      <BuildsHome />
      <FaqSection id="gun-builder-faq" title="Gun builder questions" entries={FAQ} />
    </div>
  );
}
