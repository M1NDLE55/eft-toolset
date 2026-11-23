import type { Metadata } from "@/app/lib/seo/metadata";
import Link from "@/app/lib/navigation/link";
import { AmmoTable } from "@/app/components/reference/ammo-table";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { ServerModeNote } from "@/components/game-mode/server-mode-note";
import type { GameMode } from "@/components/game-mode/mode";
import { AMMO_HUB_DESCRIPTION, AMMO_HUB_TITLE, bestByCaliber, type Caliber } from "@/app/lib/seo/ammo";
import { FaqSection } from "@/app/components/seo/faq-section";

export const ammoHubMetadata: Metadata = {
  title: AMMO_HUB_TITLE,
  description: AMMO_HUB_DESCRIPTION,
  alternates: { canonical: "/ammo" },
  openGraph: {
    title: `${AMMO_HUB_TITLE} | EFT Toolset`,
    description: AMMO_HUB_DESCRIPTION,
    url: "/ammo",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
};

const COMMON = ["545x39", "556x45NATO", "762x39", "762x51", "762x54R", "9x19PARA", "12g"];

export interface AmmoHubData {
  gameMode: GameMode;
  calibers: Caliber[];
}

/** The ammo chart, rendered for the visitor's game mode. */
export function AmmoHub({ data: { gameMode, calibers } }: { data: AmmoHubData }) {
  const best = bestByCaliber(calibers, COMMON);
  const faq = [
    ...(best.length
      ? [{ question: "What is the best ammo in Tarkov?", answer: `Against armor, the highest-penetration rounds of the common calibres are ${best.join(", ")}. Open a calibre for every round and its price.` }]
      : []),
    {
      question: "What do penetration and armor damage mean?",
      answer:
        "Penetration is how well a round goes through armor: the higher it is compared with the armor's class and condition, the more likely it goes through. Armor damage is how much of the round's damage the armor's durability takes when it's hit.",
    },
    {
      question: "Are the ammo prices live?",
      answer:
        "Yes. Each round shows the cheapest current price from a trader or the flea market, for PVP or PVE depending on the switch in the header. Rounds no one sells are marked loot only.",
    },
  ];
  return (
    <div className="flex w-full max-w-5xl flex-col gap-8">
      <JsonLd data={breadcrumbList([{ name: "EFT Toolset", path: "/" }, { name: "Ammo chart", path: "/ammo" }])} />
      <JsonLd data={faqPage(faq)} />
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Tarkov ammo chart</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          Every Escape from Tarkov round by calibre, highest penetration first, with damage, armor damage,
          fragmentation chance, speed, recoil and the cheapest place to buy it.{" "}
          <ServerModeNote rendered={gameMode} />
        </p>
      </header>
      {calibers.length === 0 ? (
        <p className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">
          Ammo data is temporarily unavailable. Try again in a moment.
        </p>
      ) : (
        <>
          <nav aria-label="Calibres" className="flex flex-wrap gap-2">
            {calibers.map((caliber) => (
              <Link
                key={caliber.id}
                href={`/ammo/${caliber.slug}`}
                className="border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
              >
                {caliber.name}
              </Link>
            ))}
          </nav>
          {calibers.map((caliber) => (
            <AmmoTable key={caliber.id} caliber={caliber} headingLevel={3} />
          ))}
        </>
      )}
      <FaqSection id="ammo-faq" title="Ammo questions" entries={faq} />
    </div>
  );
}
