import Item from "@/app/components/item/Item";
import GraphQL from "@/app/lib/GraphQL";
import { itemMetaQuery, itemDataQuery } from "@/app/lib/Queries";
import { Suspense } from "react";

function getParam(params) {
  const paramItemName = params.itemName;

  const URLParams = new URLSearchParams(params);
  const itemName = decodeURIComponent(URLParams.get("itemName"));

  return { itemName: itemName, paramItemName: paramItemName };
}

export async function generateMetadata({ params }, parent) {
  const { itemName, paramItemName } = getParam(params);

  const response = await GraphQL(itemMetaQuery(itemName));

  if (response.errors || response.data.items.length === 0) {
    return parent;
  }

  const inspectImageLink = response.data.items[0].inspectImageLink;

  return {
    title: `${itemName} | EFT Toolset`,
    description: `View details about ${itemName}`,
    openGraph: {
      title: `${itemName.substring(0, 21)}${
        itemName.length > 20 ? "..." : ""
      } | EFT Toolset`,
      description: `View details about ${itemName}`,
      url: `https://tarkov.webdevewan.com/item/${paramItemName}`,
      siteName: "Item Scanner | EFT Toolset",
      images: [
        {
          url: inspectImageLink,
          height: 1200,
          width: 630,
        },
      ],
      type: "website",
    },
  };
}

export default async function Page({ params }) {
  const { itemName } = getParam(params);

  return (
    <>
      <h1 className="absolute -top-10 -left-10">{/* //todo */}</h1>
      <Suspense fallback={<LoadingSkeleton />}>
        <ItemWrapper itemName={itemName} />
      </Suspense>
    </>
  );
}

async function ItemWrapper({ itemName }) {
  const response = await GraphQL(itemDataQuery(itemName));

  return <Item itemName={itemName} parentResponse={response} />;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="rounded-md bg-neutral-700 h-[84px]"></div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4`}>
        <div className="flex-1 bg-neutral-700 h-[84px] rounded-md"></div>
        <div className="flex-1 bg-neutral-700 h-[84px] rounded-md"></div>
      </div>
      <div className="rounded-md bg-neutral-700 h-[84px]"></div>
    </div>
  );
}
