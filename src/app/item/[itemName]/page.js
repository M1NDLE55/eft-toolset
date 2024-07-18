import GraphQL from "@/app/lib/GraphQL";
import { itemMetaQuery, itemDataQuery } from "@/app/lib/Queries";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import UsedInTasks from "@/app/components/item/UsedInTasks";
import LoadingSkeleton from "@/app/components/item/LoadingSkeleton";
import { createItem, getParam } from "@/app/components/item/functions";
import GenericDetails from "@/app/components/item/GenericDetails";

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
      <h1 className="absolute -top-10 -left-10">{itemName}</h1>
      <Suspense fallback={<LoadingSkeleton />}>
        <ItemWrapper itemName={itemName} />
      </Suspense>
    </>
  );
}

async function ItemWrapper({ itemName }) {
  const response = await GraphQL(itemDataQuery(itemName));

  if (response.errors) {
    return (
      <div className="bg-red-200 border-red-700 border rounded-md p-3 flex flex-row gap-2">
        <AlertTriangle className="text-red-700" />
        <div className="flex flex-col gap-2">
          {response.errors.map((error, i) => (
            <p className="text-red-700" key={error.message + `${i}`}>
              {error.message}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (response.data.items.length === 0) {
    return (
      <div className="bg-red-200 border-red-700 border rounded-md p-3 flex flex-row gap-2">
        <AlertTriangle className="text-red-700" />
        <div className="flex flex-col gap-2">
          <p className="text-red-700">
            The item &quot;{itemName}&quot; wasn&apos;t found
          </p>
        </div>
      </div>
    );
  }

  const responseItem = response.data.items[0];
  const item = createItem(responseItem, itemName);

  return (
    <div className="flex flex-col gap-4 text-white">
      <GenericDetails item={item} itemName={itemName} />
      <UsedInTasks tasks={item.usedInTasks} />
    </div>
  );
}
