import type { Metadata } from "next";
import { ItemPageClient } from "./item-page-client";
import { resolveItemRoute } from "./item-route";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { itemFaq, itemPageDescription, itemPageTitle } from "@/app/lib/seo/item";
import { ITEM_HUB_NAME } from "@/app/lib/seo/site-copy";

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

export default async function Page({ params }: ItemPageProps) {
  const { gameMode, item, reference, canonical, renderedAt } = await resolveItemRoute((await params).itemName);
  if (!reference) return null;
  return (
    <>
      {item && canonical && (
        <>
          <JsonLd
            data={breadcrumbList([
              { name: "EFT Toolset", path: "/" },
              { name: ITEM_HUB_NAME, path: "/item" },
              { name: item.name, path: `/item/${canonical}` },
            ])}
          />
          <JsonLd data={faqPage(itemFaq(item))} />
        </>
      )}
      <ItemPageClient reference={reference} initial={item ? { gameMode, item, renderedAt } : null} />
    </>
  );
}
