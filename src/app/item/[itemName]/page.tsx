import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ItemPageClient } from "./item-page-client";
import { ITEM_VIEW_COOKIE, decodeViewCookie } from "@/app/lib/item-views/views";
import { readItemWiki } from "@/app/lib/wiki/item-wiki";
import { resolveItemRoute } from "./item-route";
import { JsonLd, breadcrumbList } from "@/app/components/seo/json-ld";
import { itemPageDescription, itemPageTitle } from "@/app/lib/seo/item";
import { ITEM_HUB_NAME } from "@/app/lib/seo/site-copy";
import { ItemQuestLinks } from "@/app/components/item/item-quests";
import { questsUsingItem } from "@/app/lib/quests/item-quests";
import { loadQuestList } from "@/app/quests/load";

interface ItemPageProps {
  params: Promise<{ itemName: string }>;
}

export async function generateMetadata({ params }: ItemPageProps): Promise<Metadata> {
  const { item, name, canonical } = await resolveItemRoute((await params).itemName);
  // The item couldn't be loaded in time. Visitors load it in the browser; never tell crawlers
  // to drop the page over a temporary failure (they get a server error from the layout).
  if (!item && !name) return { title: "Item prices" };
  if (!item) return { title: name, robots: { index: false, follow: true } };
  const title = itemPageTitle(item);
  const description = itemPageDescription(item);
  const images = item.gridImageLink ? [{ url: item.gridImageLink }] : [{ url: "/item-scanner-og.png", width: 1200, height: 630 }];
  const url = canonical ? `/item/${canonical}` : undefined;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: { title: `${title} | EFT Toolset`, description, type: "article", url, images },
    twitter: { card: "summary", title: `${title} | EFT Toolset`, description, images: images.map((image) => image.url) },
  };
}

/** The view the visitor last chose, which the client keeps in a cookie; crawlers get the default. */
async function requestItemLayout() {
  const raw = (await cookies()).get(ITEM_VIEW_COOKIE)?.value;
  let value = raw;
  try {
    value = raw && decodeURIComponent(raw);
  } catch {
    // Leave it as sent; decoding fails only on a cookie we didn't write.
  }
  return decodeViewCookie(value);
}

export default async function Page({ params }: ItemPageProps) {
  const { gameMode, item, reference, canonical, renderedAt } = await resolveItemRoute((await params).itemName);
  if (!reference) return null;
  // The quest list is optional here: without it in time, the page just goes without its quest links.
  const [layout, wiki, quests] = await Promise.all([
    requestItemLayout(),
    item ? readItemWiki(item.id) : null,
    item ? loadQuestList() : undefined,
  ]);
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
        layout={{ id: layout.id, cards: layout.cards }}
      />
      {usedBy && <ItemQuestLinks quests={usedBy} />}
    </>
  );
}
