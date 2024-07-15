import Scanner from "../components/scanner/Scanner";
import GraphQL from "../features/data/GraphQL";
import { itemMetaQuery } from "../features/data/Queries";

export async function generateMetadata({ searchParams }, parent) {
  const id = searchParams.item;

  const baseMetaData = {
    title: "Item Scanner | EFT Toolset",
    description: "View details of any item in Escape From Tarkov",
    openGraph: {
      title: "Item Scanner | EFT Toolset",
      description: "View details of any item in Escape From Tarkov",
      url: "https://tarkov.webdevewan.com/scanner",
      siteName: "Item Scanner | EFT Toolset",
      images: [
        {
          url: "https://tarkov.webdevewan.com/item-scanner-og.png",
          height: 1200,
          width: 630,
        },
      ],
      type: "website",
    },
  };

  if (!id) {
    return baseMetaData;
  }

  const response = await GraphQL(itemMetaQuery(id));

  if (response.errors) {
    return baseMetaData;
  }

  const item = response.data.item;
  const params = new URLSearchParams();
  params.set("item", id);

  return {
    title: `${item.name} | EFT Toolset`,
    description: `View details about ${item.name}`,
    openGraph: {
      title: `${item.name.substring(0, 21)}${
        item.name.length > 20 ? "..." : ""
      } | EFT Toolset`,
      description: `View details about ${item.name}`,
      url: `https://tarkov.webdevewan.com/scanner?${params.toString()}`,
      siteName: "Item Scanner | EFT Toolset",
      images: [
        {
          url: item.inspectImageLink,
          height: 1200,
          width: 630,
        },
      ],
      type: "website",
    },
  };
}

export default function Page() {
  return <Scanner />;
}
