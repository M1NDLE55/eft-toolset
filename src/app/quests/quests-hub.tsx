import type { Metadata } from "@/app/lib/seo/metadata";
import Link from "@/app/lib/navigation/link";
import { QuestsPageFromUrl } from "@/app/components/quests/quests-page-from-url";
import { FaqSection } from "@/app/components/seo/faq-section";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import type { GameMode } from "@/components/game-mode/mode";
import { QUEST_HUB_DESCRIPTION, QUEST_HUB_NAME, QUEST_HUB_TITLE, questHubFaq } from "@/app/lib/seo/quests";
import type { QuestList } from "@/app/lib/quests/types";

export const questsHubMetadata: Metadata = {
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

/** The quest hub, rendered with the visitor's game mode's quest list. */
export function QuestsHub({ loaded }: { loaded: { gameMode: GameMode; list: QuestList; renderedAt: number } }) {
  const faq = questHubFaq(loaded.list);
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
      <QuestsPageFromUrl initial={loaded} />
      <FaqSection id="quests-faq" title="Quest tracker questions" entries={faq} />
    </div>
  );
}
