import type { ComposedItem } from "@/app/lib/cache/types";
import type { ItemReference } from "@/app/lib/cache/fetcher";
import type { Metadata } from "@/app/lib/seo/metadata";
import type { ItemWiki } from "@/app/lib/wiki/item-wiki";
import type { ItemQuests } from "@/app/lib/quests/item-quests";
import { ItemPageClient } from "./item-page-client";
import { JsonLd, breadcrumbList } from "@/app/components/seo/json-ld";
import { itemSummary } from "@/app/lib/seo/item";
import { heading } from "@/app/components/quests/quest-bits";
import { ITEM_HUB_NAME } from "@/app/lib/seo/site-copy";
import { ItemQuestLinks } from "@/app/components/item/item-quests";
import type { GameMode } from "@/components/game-mode/mode";
import type { RenderDataUnavailableError } from "@/app/lib/render-errors";
import { itemReference } from "@/app/lib/item-links";
import { NotFoundPage, useReportPageError } from "@/app/components/global/route-status";

/** What the item page renders, read on the server for the visitor's game mode (item-page.server.ts). */
export interface ItemPageData {
  gameMode: GameMode;
  reference: ItemReference;
  item: ComposedItem;
  canonical: string | null;
  renderedAt: number;
  /** The item's wiki page, the same in every game mode; null without one. */
  wiki: ItemWiki | null;
  /** The quests that use the item, when the quest list was read in time. */
  usedBy: ItemQuests | null;
  metadata: Metadata;
}

export function ItemPage({ data }: { data: ItemPageData }) {
  const { item, reference, canonical, renderedAt, gameMode, wiki, usedBy } = data;
  return (
    <>
      {canonical && (
        <JsonLd
          data={breadcrumbList([
            { name: "EFT Toolset", path: "/" },
            { name: ITEM_HUB_NAME, path: "/item" },
            { name: item.name, path: `/item/${canonical}` },
          ])}
        />
      )}
      <ItemPageClient reference={reference} initial={{ gameMode, item, renderedAt }} wiki={wiki} />
      <section aria-labelledby="item-summary" className="flex flex-col gap-2 pt-2">
        <h2 id="item-summary" className={heading}>
          About {item.name}
        </h2>
        <div className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-4 text-sm leading-relaxed text-[#ccc]">
          {itemSummary(item, usedBy).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </section>
      {usedBy && <ItemQuestLinks quests={usedBy} />}
    </>
  );
}

/**
 * The item page when the server couldn't load the item in time. The response stays a server error,
 * so crawlers retry and the edge cache keeps its copy, but the visitor's browser loads the item
 * itself rather than showing the error page.
 */
export function ItemPageFallback({ segment, error }: { segment: string; error: RenderDataUnavailableError }) {
  useReportPageError(error);
  const reference = itemReference(segment);
  if (!reference) return <NotFoundPage />;
  return <ItemPageClient reference={reference} initial={null} wiki={null} />;
}
