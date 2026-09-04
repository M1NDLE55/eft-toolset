import type { Metadata } from "next";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";
import { ItemPageClient } from "./item-page-client";
import { notFound } from "next/navigation";

interface ItemPageProps {
  params: Promise<{ itemName: string }>;
}

export async function generateMetadata({ params }: ItemPageProps): Promise<Metadata> {
  const itemName = customDecodeURI((await params).itemName);
  if (!itemName) return { title: "Item not found", robots: { index: false, follow: false } };
  return {
    title: itemName,
    description: `Prices, trader offers, tasks, barters, and crafts for ${itemName} in Escape from Tarkov.`,
    alternates: { canonical: `/item/${customEncodeURI(itemName)}` },
    openGraph: {
      title: `${itemName} | EFT Toolset`,
      description: `Escape from Tarkov market and task details for ${itemName}.`,
      type: "article",
      url: `/item/${customEncodeURI(itemName)}`,
      images: [{ url: "/item-scanner-og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${itemName} | EFT Toolset`,
      description: `Escape from Tarkov market and task details for ${itemName}.`,
      images: ["/item-scanner-og.png"],
    },
  };
}

export default async function Page({ params }: ItemPageProps) {
  const itemName = customDecodeURI((await params).itemName);
  if (!itemName) notFound();
  return <ItemPageClient itemName={itemName} />;
}
