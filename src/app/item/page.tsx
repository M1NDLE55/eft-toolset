import type { Metadata } from "next";
import Link from "next/link";
import { RecentItems } from "@/app/components/item/scouted-items";
import { PriceHighlightTables } from "@/app/components/item/price-highlights";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { getPriceHighlights } from "@/app/lib/api/tarkov-server";
import { readForRender, requestGameMode } from "@/app/lib/api/server-render";
import { ITEM_HUB_DESCRIPTION, ITEM_HUB_NAME, ITEM_HUB_TITLE } from "@/app/lib/seo/site-copy";

export const metadata: Metadata = {
  title: ITEM_HUB_TITLE,
  description: ITEM_HUB_DESCRIPTION,
  alternates: { canonical: "/item" },
};

const FAQ = [
  {
    question: "How often do Tarkov flea market prices update?",
    answer:
      "Prices come from tarkov.dev, which updates flea market prices every few minutes. EFT Toolset fetches fresh prices whenever its copy is more than five minutes old, so item pages track what players are listing at.",
  },
  {
    question: "What is the best price to sell an item for?",
    answer:
      "Each item page compares the flea market, after its listing fee, with every trader that buys the item and marks the best. The flea market usually pays more, but traders pay instantly with no fee and no flea level requirement.",
  },
  {
    question: "What does price per slot mean?",
    answer:
      "Price per slot is the best sell price divided by the inventory slots an item takes. It is the quickest way to decide what to keep in a full backpack: a 1×1 item worth 60,000 ₽ beats a 2×2 item worth 200,000 ₽.",
  },
  {
    question: "Are PVE flea market prices different from PVP?",
    answer:
      "Yes. PVE has its own flea market and economy, so prices can differ a lot. Use the PVP / PVE switch in the header and every price on the site changes to that mode.",
  },
  {
    question: "Should I keep an item for quests or the hideout?",
    answer:
      "Every item page lists the tasks and hideout upgrades that need the item, how many, and whether they must be found in raid, so you know whether to keep it or sell it.",
  },
];

export default async function Page() {
  const gameMode = await requestGameMode();
  const highlights = await readForRender("Item prices page", () => getPriceHighlights(gameMode));
  return (
    <>
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: ITEM_HUB_NAME, path: "/item" },
        ])}
      />
      <JsonLd data={faqPage(FAQ)} />
      <div className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
        <h1 className="text-sm font-bold uppercase tracking-widest text-[#c8b384]">Tarkov flea market prices</h1>
        <p className="text-sm text-[#999]">
          Live flea market and trader prices for every Escape from Tarkov item, in PVP and PVE. Search any item to see
          what it sells for, the best place to sell it after the flea fee, its value per slot, and every task, hideout
          upgrade, barter and craft that needs it. Press <kbd className="border border-[#2a2a2a] px-1 text-[11px]">/</kbd>{" "}
          anywhere to search. Playing PVE? See the{" "}
          <Link href="/flea-market/pve" className="text-[#c8b384] underline underline-offset-2">
            PVE flea market prices
          </Link>
          .
        </p>
      </div>
      <RecentItems />
      {highlights && <PriceHighlightTables gameMode={gameMode} highlights={highlights} />}
      <section aria-labelledby="price-faq" className="flex flex-col gap-2">
        <h2 id="price-faq" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
          Flea market price questions
        </h2>
        <dl className="flex flex-col divide-y divide-[#1a1a1a] border border-[#1a1a1a] bg-[#0c0c0c]">
          {FAQ.map((entry) => (
            <div key={entry.question} className="flex flex-col gap-1 px-3 py-2.5">
              <dt className="text-sm font-semibold text-[#ddd]">{entry.question}</dt>
              <dd className="text-sm text-[#999]">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
