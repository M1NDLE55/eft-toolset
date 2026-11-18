import type { Metadata } from "next";
import Link from "next/link";
import { QuestsPage } from "@/app/components/quests/quests-page";
import { FaqSection } from "@/app/components/seo/faq-section";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { isCrawlerRequest } from "@/app/lib/api/server-render";
import { QUEST_HUB_DESCRIPTION, QUEST_HUB_NAME, QUEST_HUB_TITLE, questHubFaq } from "@/app/lib/seo/quests";
import { loadQuestList } from "./load";

export const metadata: Metadata = {
  title: QUEST_HUB_TITLE,
  description: QUEST_HUB_DESCRIPTION,
  alternates: { canonical: "/quests" },
  openGraph: {
    title: `${QUEST_HUB_TITLE} | EFT Toolset`,
    description: QUEST_HUB_DESCRIPTION,
    url: "/quests",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: `${QUEST_HUB_TITLE} | EFT Toolset`, description: QUEST_HUB_DESCRIPTION },
};

class QuestsUnavailableError extends Error {
  constructor() {
    super("Quest data is temporarily unavailable.");
    this.name = "QuestsUnavailableError";
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [loaded, search] = await Promise.all([loadQuestList(), searchParams]);
  // Visitors load the list in the browser; crawlers get a server error to retry rather than an empty page.
  if (!loaded && (await isCrawlerRequest())) throw new QuestsUnavailableError();
  const faq = questHubFaq(loaded?.list ?? null);
  return (
    <div className="flex w-full max-w-5xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: QUEST_HUB_NAME, path: "/quests" },
        ])}
      />
      <JsonLd data={faqPage(faq)} />
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Tarkov quests</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          Every quest by trader, level and map. Tick off what you&apos;ve done to see what&apos;s available now, every item your
          remaining quests need (found in raid marked), and each trader&apos;s chain. Progress is saved in this browser, separately
          for PVP and PVE; switch modes in the header. Keys for each map are on{" "}
          <Link href="/keys" className="text-[#c8b384] underline underline-offset-2">
            keys by map
          </Link>
          .
        </p>
      </header>
      <QuestsPage initial={loaded ?? null} search={search} />
      <FaqSection id="quests-faq" title="Quest tracker questions" entries={faq} />
    </div>
  );
}
