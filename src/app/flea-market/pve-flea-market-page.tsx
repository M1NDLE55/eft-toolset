import type { Metadata } from "@/app/lib/seo/metadata";
import Link from "@/app/lib/navigation/link";
import { FixedModePriceTables } from "@/app/components/item/price-highlights";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import type { PriceHighlights } from "@/app/lib/api/tarkov-server";
import { UseModeButton } from "@/components/game-mode/use-mode-button";
import { FaqSection } from "@/app/components/seo/faq-section";

const TITLE = "Tarkov PVE Flea Market Prices: Live PVE Item Values";
const DESCRIPTION =
  "Live Escape from Tarkov PVE flea market prices: the most valuable PVE loot per slot, the most expensive items and keys, and a price checker for every item with trader prices and quest uses.";

export const PVE_FLEA_MARKET_METADATA: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/flea-market/pve" },
  openGraph: { title: `${TITLE} | EFT Toolset`, description: DESCRIPTION, url: "/flea-market/pve", images: [{ url: "/item-scanner-og.png", width: 1200, height: 630 }] },
};

const FAQ = [
  {
    question: "Are PVE flea market prices different from PVP?",
    answer:
      "Yes. PVE has its own flea market and economy, so the same item can sell for very different amounts. This page always shows PVE prices; switch the header to PVE to see PVE prices on every item page and tool.",
  },
  {
    question: "How often do PVE prices update?",
    answer:
      "Prices come from tarkov.dev, which updates them about every ten minutes. EFT Toolset fetches them as soon as tarkov.dev publishes, and an open page updates by itself.",
  },
  {
    question: "What should I sell in PVE?",
    answer:
      "Check the tables below for the items worth most per inventory slot, then open an item to see whether a task or hideout upgrade still needs it before you sell.",
  },
];

/** Always PVE prices, whatever the visitor's mode. */
export function PveFleaMarketPage({ highlights }: { highlights: PriceHighlights }) {
  return (
    <>
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: "Tarkov item prices", path: "/item" },
          { name: "PVE flea market prices", path: "/flea-market/pve" },
        ])}
      />
      <JsonLd data={faqPage(FAQ)} />
      <div className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
        <h1 className="text-sm font-bold uppercase tracking-widest text-[#c8b384]">Tarkov PVE flea market prices</h1>
        <p className="text-sm text-[#999]">
          Live flea market prices for Escape from Tarkov PVE. To check any item, switch the header to PVE and{" "}
          <Link href="/item" className="text-[#c8b384] underline underline-offset-2">
            search the item prices
          </Link>
          : every item shows its PVE flea and trader prices, the best place to sell it, and the tasks and hideout upgrades
          that need it.
        </p>
        <UseModeButton mode="pve" />
      </div>
      {highlights ? (
        <FixedModePriceTables gameMode="pve" highlights={highlights} />
      ) : (
        <p className="text-sm text-[#888]">PVE prices are temporarily unavailable. Try again in a moment.</p>
      )}
      <FaqSection id="pve-faq" title="PVE price questions" entries={FAQ} />
    </>
  );
}
