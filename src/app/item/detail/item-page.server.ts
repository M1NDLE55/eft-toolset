import { notFound, redirect } from "@tanstack/react-router";
import type { Metadata } from "@/app/lib/seo/metadata";
import { readItemWiki } from "@/app/lib/wiki/item-wiki";
import { RenderDataUnavailableError } from "@/app/lib/render-errors";
import { loadItemIndexing, resolveItemRoute } from "./item-route";
import { itemPageDescription, itemPageTitle } from "@/app/lib/seo/item";
import { questsUsingItem } from "@/app/lib/quests/item-quests";
import { loadQuestList } from "@/app/quests/load";
import type { GameMode } from "@/components/game-mode/mode";
import type { ItemPageData } from "./item-page";

/**
 * The item page for one game mode. A near-duplicate or old name link redirects permanently to the
 * item's page, an unknown item is a 404, and an item that couldn't be loaded in time fails the
 * render, so the edge cache keeps its previous copy (and a first render answers with a 500, while
 * the browser loads the item itself: the route's errorComponent).
 */
export async function loadItemPage(gameMode: GameMode, segment: string): Promise<ItemPageData> {
  const { item, canonical, reference, renderedAt } = await resolveItemRoute(gameMode, segment);
  if (canonical && canonical !== segment) throw redirect({ href: `/item/${canonical}`, statusCode: 308 });
  if (!reference || item === null) throw notFound();
  if (item === undefined) throw new RenderDataUnavailableError("Item page");

  // The quest list is optional: without it in time, the page just goes without its quest links.
  const [wiki, quests, indexing] = await Promise.all([
    readItemWiki(item.id),
    loadQuestList(gameMode),
    canonical ? loadItemIndexing(canonical) : undefined,
  ]);
  // The canonical URL and robots tag are cached with the page: without the index, fail the render
  // rather than let a near-duplicate name itself as canonical for hours.
  if (canonical && indexing === undefined) throw new RenderDataUnavailableError("Item page");
  const usedBy = quests?.gameMode === gameMode ? questsUsingItem(quests.list, item.id) : null;

  const title = itemPageTitle(item);
  const description = itemPageDescription(item, usedBy);
  const images = item.gridImageLink ? [{ url: item.gridImageLink }] : [{ url: "/item-scanner-og.png", width: 1200, height: 630 }];
  // A near-duplicate (a weapon's default preset, a numbered copy of a name) names the page to show
  // instead; an ammo pack isn't indexed. Without the index in time, the page is its own canonical.
  const url = indexing?.kind === "canonical" ? `/item/${indexing.slug}` : canonical ? `/item/${canonical}` : undefined;
  const metadata: Metadata = {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    ...(indexing?.kind === "noindex" ? { robots: { index: false, follow: true } } : {}),
    openGraph: { title: `${title} | EFT Toolset`, description, type: "article", url, images },
    twitter: { card: "summary", title: `${title} | EFT Toolset`, description, images: images.map((image) => image.url) },
  };
  return { gameMode, reference, item, canonical, renderedAt, wiki, usedBy, metadata };
}
