import GraphQL from "@/app/lib/GraphQL";
import { itemMetaQuery, itemDataQuery } from "@/app/lib/Queries";
import { Suspense } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { AlertTriangle } from "lucide-react";
import { Rubles } from "@/app/features/data/Currency";
import UsedInTasks from "@/app/components/item/UsedInTasks";

function createItem(item, itemName) {
  const fleaMarket =
    (item.fleaMarketFee &&
      item.sellFor.find((sellFor) => sellFor.vendor.name === "Flea Market")) ||
    null;

  return {
    name: itemName,
    fleaMarketFee: item.fleaMarketFee,
    gridImageLink: item.gridImageLink,
    wikiLink: item.wikiLink,
    buyFor: [
      item.buyFor.reduce((acc, buyFor) => {
        if (buyFor.vendor.name === "Flea Market") {
          return acc;
        }
        if (!acc || buyFor.priceRUB < acc.priceRUB) {
          return buyFor;
        }
        return acc;
      }, null),
      fleaMarket,
    ]
      .filter((item) => item !== null)
      .sort((a, b) => a.priceRUB - b.priceRUB),
    sellFor: [
      item.sellFor.reduce((acc, sellFor) => {
        if (sellFor.vendor.name === "Flea Market") {
          return acc;
        }
        if (!acc || sellFor.priceRUB > acc.priceRUB) {
          return sellFor;
        }
        return acc;
      }, null),
      ,
      fleaMarket,
    ]
      .filter((item) => item !== null)
      .sort((a, b) => b.priceRUB - a.priceRUB),
    usedInTasks: item.usedInTasks.sort((a, b) => {
      if (a.trader.name < b.trader.name) {
        return -1;
      }
      if (a.trader.name > b.trader.name) {
        return 1;
      }
      return a.minPlayerLevel - b.minPlayerLevel;
    }),
  };
}

function getParam(params) {
  const paramItemName = params.itemName;

  const URLParams = new URLSearchParams(params);
  const itemName = customDecodeURI(URLParams.get("itemName"));

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
      <div>
        <h2 className="text-lg">Item</h2>
        <div className="bg-neutral-700 rounded-md p-3 flex flex-row gap-4 items-center shadow-md">
          {/* eslint-disable-next-line */}
          <img
            src={item.gridImageLink}
            alt={`Image of an ${itemName}`}
            height={64}
            width={64}
          />
          <div>
            <p>Name: {itemName}</p>
            <p>
              {(item.fleaMarketFee &&
                `Flea Market Fee: ${Rubles.format(item.fleaMarketFee)}`) ||
                "Cannot be listed on flea market"}
            </p>
            <a
              href={item.wikiLink}
              target="blank"
              className="underline underline-offset-2 text-yellow-500 hover:underline-offset-4 transition-[text-underline-offset]"
            >
              View on Wiki
            </a>
          </div>
        </div>
      </div>
      <div
        className={`grid grid-cols-1 ${
          item.buyFor.length > 0 && item.sellFor.length > 0 && "sm:grid-cols-2"
        } gap-4`}
      >
        {item.buyFor.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Buy For</h2>
            <div className="bg-neutral-700 rounded-md p-3 shadow-md flex-1">
              {item.buyFor.map((buyFor) => (
                <p
                  key={`buyFor${buyFor.vendor.name}`}
                  className="flex flex-row justify-between"
                >
                  <span>{buyFor.vendor.name}</span>
                  <span>{Rubles.format(buyFor.priceRUB)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
        {item.sellFor.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Sell For</h2>
            <div className="bg-neutral-700 rounded-md p-3 shadow-md flex-1">
              {item.sellFor.map((sellFor) => (
                <p
                  key={`sellFor${sellFor.vendor.name}`}
                  className="flex flex-row justify-between"
                >
                  <span>{sellFor.vendor.name}</span>
                  <span>{Rubles.format(sellFor.priceRUB)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      <UsedInTasks tasks={item.usedInTasks} />
    </div>
  );
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
