import type { Metadata } from "next";
import Link from "next/link";
import { AmmoTable } from "@/app/components/reference/ammo-table";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { ServerModeNote } from "@/components/game-mode/server-mode-note";
import { isCrawlerRequest } from "@/app/lib/api/server-render";
import { AMMO_HUB_DESCRIPTION, AMMO_HUB_TITLE, bestByCaliber } from "@/app/lib/seo/ammo";
import { loadCalibers } from "./load";

export const metadata: Metadata = {
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

class AmmoUnavailableError extends Error {
  constructor() {
    super("Ammo data is temporarily unavailable.");
    this.name = "AmmoUnavailableError";
  }
}

const COMMON = ["545x39", "556x45NATO", "762x39", "762x51", "762x54R", "9x19PARA", "12g"];

export default async function Page() {
  const loaded = await loadCalibers();
  if (!loaded && (await isCrawlerRequest())) throw new AmmoUnavailableError();
  const calibers = loaded?.calibers ?? [];
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
          {loaded && <ServerModeNote rendered={loaded.gameMode} />}
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
      <section aria-labelledby="ammo-faq" className="flex flex-col gap-2">
        <h2 id="ammo-faq" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
          Ammo questions
        </h2>
        <dl className="flex flex-col divide-y divide-[#1a1a1a] border border-[#1a1a1a] bg-[#0c0c0c]">
          {faq.map((entry) => (
            <div key={entry.question} className="flex flex-col gap-1 px-3 py-2.5">
              <dt className="text-sm font-semibold text-[#ddd]">{entry.question}</dt>
              <dd className="text-sm text-[#999]">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
