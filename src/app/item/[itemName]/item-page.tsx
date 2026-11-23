import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ItemPageClient } from "./item-page-client";
import { readItemWiki } from "@/app/lib/wiki/item-wiki";
import { ItemTemporarilyUnavailableError, loadItemIndexing, resolveItemRoute } from "./item-route";
import { JsonLd, breadcrumbList } from "@/app/components/seo/json-ld";
import { itemPageDescription, itemPageTitle, itemSummary } from "@/app/lib/seo/item";
import { heading } from "@/app/components/quests/quest-bits";
import { ITEM_HUB_NAME } from "@/app/lib/seo/site-copy";
import { ItemQuestLinks } from "@/app/components/item/item-quests";
import { questsUsingItem } from "@/app/lib/quests/item-quests";
import { loadQuestList } from "@/app/quests/load";
import type { GameMode } from "@/components/game-mode/mode";

/** The item page for one game mode: /item/[itemName] renders PVP, and its PVE copy PVE. */
export interface ItemPageProps {
  params: Promise<{ itemName: string }>;
}

/** Redirects a near-duplicate or old name link to the item's page, and 404s an unknown one. */
export async function ItemRouteLayout({ children, params, gameMode }: ItemPageProps & { children: ReactNode; gameMode: GameMode }) {
  const segment = (await params).itemName;
  const { item, canonical, reference } = await resolveItemRoute(gameMode, segment);
  if (canonical && canonical !== segment) permanentRedirect(`/item/${canonical}`);
  if (!reference || item === null) notFound();
  if (item === undefined) throw new ItemTemporarilyUnavailableError();
  return children;
}

export async function itemMetadata({ params }: ItemPageProps, gameMode: GameMode): Promise<Metadata> {
  const { item, name, canonical } = await resolveItemRoute(gameMode, (await params).itemName);
  // The item couldn't be loaded in time: the layout fails the render. Never tell crawlers to
  // drop the page over a temporary failure.
  if (!item && !name) return { title: "Item prices" };
  if (!item) return { title: name, robots: { index: false, follow: true } };
  const title = itemPageTitle(item);
  // A near-duplicate (a weapon's default preset, a numbered copy of a name) names the page to show
  // instead; an ammo pack isn't indexed. Without the index in time, the page is its own canonical.
  const [quests, indexing] = await Promise.all([loadQuestList(gameMode), canonical ? loadItemIndexing(canonical) : undefined]);
  const description = itemPageDescription(item, quests?.gameMode === gameMode ? questsUsingItem(quests.list, item.id) : null);
  const images = item.gridImageLink ? [{ url: item.gridImageLink }] : [{ url: "/item-scanner-og.png", width: 1200, height: 630 }];
  const url = indexing?.kind === "canonical" ? `/item/${indexing.slug}` : canonical ? `/item/${canonical}` : undefined;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    ...(indexing?.kind === "noindex" ? { robots: { index: false, follow: true } } : {}),
    openGraph: { title: `${title} | EFT Toolset`, description, type: "article", url, images },
    twitter: { card: "summary", title: `${title} | EFT Toolset`, description, images: images.map((image) => image.url) },
  };
}

export async function ItemPage({ params, gameMode }: ItemPageProps & { gameMode: GameMode }) {
  const { item, reference, canonical, renderedAt } = await resolveItemRoute(gameMode, (await params).itemName);
  if (!reference) return null;
  // The quest list is optional here: without it in time, the page just goes without its quest links.
  const [wiki, quests] = await Promise.all([item ? readItemWiki(item.id) : null, item ? loadQuestList(gameMode) : undefined]);
  const usedBy = item && quests?.gameMode === gameMode ? questsUsingItem(quests.list, item.id) : null;
  return (
    <>
      {item && canonical && (
        <JsonLd
          data={breadcrumbList([
            { name: "EFT Toolset", path: "/" },
            { name: ITEM_HUB_NAME, path: "/item" },
            { name: item.name, path: `/item/${canonical}` },
          ])}
        />
      )}
      <ItemPageClient
        reference={reference}
        initial={item ? { gameMode, item, renderedAt } : null}
        wiki={wiki}
      />
      {item && (
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
      )}
      {usedBy && <ItemQuestLinks quests={usedBy} />}
    </>
  );
}
