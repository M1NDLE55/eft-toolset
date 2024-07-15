import Scanner from "../components/scanner/Scanner";
import GraphQL from "../features/data/GraphQL";
import { itemMetaQuery } from "../features/data/Queries";

export async function generateMetadata({ searchParams }, parent) {
  const id = searchParams.item;

  //todo: unique scanner page metadata

  if (!id) {
    return await parent;
  }

  const response = await GraphQL(itemMetaQuery(id));

  if (response.errors) {
    return await parent;
  }

  const item = response.data.item;
  const params = new URLSearchParams();
  params.set("item", id);

  return {
    title: `${item.name.substring(0, 11)}${
      item.name.length > 10 ? "..." : ""
    } | EFT Toolset`,
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
