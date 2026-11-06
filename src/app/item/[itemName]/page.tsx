import type { Metadata } from "next";
import { ItemPageClient } from "./item-page-client";
import { resolveItemRoute } from "./item-route";

interface ItemPageProps {
  params: Promise<{ itemName: string }>;
}

export async function generateMetadata({ params }: ItemPageProps): Promise<Metadata> {
  const { item, name, canonical } = await resolveItemRoute((await params).itemName);
  if (!item && !name) return { title: "Item", robots: { index: false, follow: true } };
  if (!name) return { title: "Item not found", robots: { index: false, follow: false } };
  const description = `Prices, trader offers, tasks, barters, and crafts for ${name} in Escape from Tarkov.`;
  const images = item?.gridImageLink ? [{ url: item.gridImageLink }] : [{ url: "/item-scanner-og.png", width: 1200, height: 630 }];
  const url = canonical ? `/item/${canonical}` : undefined;
  return {
    title: name,
    description,
    alternates: url ? { canonical: url } : undefined,
    robots: item ? undefined : { index: false, follow: true },
    openGraph: { title: `${name} | EFT Toolset`, description, type: "article", url, images },
    twitter: { card: "summary", title: `${name} | EFT Toolset`, description, images: images.map((image) => image.url) },
  };
}

export default async function Page({ params }: ItemPageProps) {
  const { gameMode, item, reference } = await resolveItemRoute((await params).itemName);
  if (!reference) return null;
  return <ItemPageClient reference={reference} initial={item ? { gameMode, item } : null} />;
}
