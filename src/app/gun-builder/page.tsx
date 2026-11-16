import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BuildsHome } from "@/app/components/gun-builder/builds-home";
import { ToolAbout } from "@/app/components/seo/tool-about";
import { JsonLd, faqPage, webApplication } from "@/app/components/seo/json-ld";
import { GUN_BUILDER_DESCRIPTION, GUN_BUILDER_TITLE } from "@/app/lib/seo/site-copy";

export const metadata: Metadata = {
  title: GUN_BUILDER_TITLE,
  description: GUN_BUILDER_DESCRIPTION,
  alternates: { canonical: "/gun-builder" },
};

const FEATURES = [
  {
    title: "Every weapon and mod",
    text: "Start from a factory preset or a bare receiver and fill each slot with compatible parts. Conflicting mods are flagged before you buy them.",
  },
  {
    title: "Live ergonomics, recoil and cost",
    text: "Vertical and horizontal recoil, ergonomics, weight and total price update as you swap parts, with the change each part makes.",
  },
  {
    title: "Recoil and ergo optimiser",
    text: "Find the lowest recoil or highest ergonomics build for a weapon, optionally under a budget, or the cheapest build that fills every required slot.",
  },
  {
    title: "Ammo picker",
    text: "Choose the round you'll run and see its recoil modifier added to the build's stats.",
  },
  {
    title: "Compare and shop",
    text: "Put builds side by side, then print or copy a shopping list with where to buy each part: trader, flea market or barter.",
  },
  {
    title: "Share builds by link",
    text: "Send a build to your squad as a link they can open and import. Builds are saved in your browser, no account needed.",
  },
];

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
      <ToolAbout
        id="about-gun-builder"
        title="Escape from Tarkov weapon builder"
        intro={
          <p>
            Build and mod any Escape from Tarkov weapon in the browser with live stats and prices. Try parts before you
            buy them, find the lowest recoil or best ergonomics setup for your budget, and share the finished build.
          </p>
        }
        features={FEATURES}
        faq={FAQ}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/gun-builder/best"
            className="group flex items-center justify-between gap-3 border border-[#3a3326] bg-[#1a1610] p-3 hover:border-[#9a8866]"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-[#e6d9b8]">Best builds for every weapon</span>
              <span className="text-sm text-[#a99a78]">
                The lowest recoil and max ergonomics build for every gun, with every part and live prices.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#9a8866] transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/gun-builder/gunsmith"
            className="group flex items-center justify-between gap-3 border border-[#3a3326] bg-[#1a1610] p-3 hover:border-[#9a8866]"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-[#e6d9b8]">Gunsmith builds</span>
              <span className="text-sm text-[#a99a78]">
                A ready build for every Gunsmith task, checked against its requirements.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#9a8866] transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </ToolAbout>
    </div>
  );
}
