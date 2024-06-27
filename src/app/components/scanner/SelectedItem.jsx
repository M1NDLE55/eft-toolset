import { useState, useEffect } from "react";
import GraphQL from "@/app/features/data/GraphQL";
import { Rubles } from "@/app/features/data/Currency";

export default function SelectedItem({ searchParams }) {
  const [item, setItem] = useState(null);

  const selectedItemQuery = (id) => `{
        item (id: "${id}") {
              name
              fleaMarketFee
              gridImageLink
              buyFor{
                vendor {
                  name
                }
                price
              }         
              sellFor{
                vendor {
                  name
                }
                price
              }         
        }
      }`;

  useEffect(() => {
    async function fetchSelectedItem() {
      const id = searchParams.get("item");

      if (!id) {
        setItem(null);
        return;
      }

      try {
        const item = (await GraphQL(selectedItemQuery(id))).data.item;

        setItem({
          name: item.name,
          fleaMarketFee: item.fleaMarketFee,
          gridImageLink: item.gridImageLink,
          fleaMarket: {
            buyForPrice:
              (item.fleaMarketFee &&
                item.buyFor.find(
                  (buyFor) => buyFor.vendor.name === "Flea Market"
                ).price) ||
              null,
            sellForPrice:
              (item.fleaMarketFee &&
                item.sellFor.find(
                  (sellFor) => sellFor.vendor.name === "Flea Market"
                ).price) ||
              null,
          },
          buyFor:
            item.buyFor
              .filter((buyFor) => buyFor.vendor.name !== "Flea Market")
              .sort((a, b) => a.price - b.price)[0] || null,
          sellFor:
            item.sellFor
              .filter((sellFor) => sellFor.vendor.name !== "Flea Market")
              .sort((a, b) => b.price - a.price)[0] || null,
        });
      } catch {
        console.log("Error on selected item load");
        setItem(null);
      }
    }

    fetchSelectedItem();
  }, [searchParams]);

  return (
    item && (
      <div className="flex flex-col gap-4 text-white">
        <div>
          <h2 className="text-lg">Item</h2>
          <div className="bg-neutral-700 rounded-md p-3 flex flex-row gap-4 items-center shadow-md">
            <img
              src={item.gridImageLink}
              alt={`Image of an ${item.name}`}
              height={64}
              width={64}
            />
            <div>
              <p>Name: {item.name}</p>
              <p>Flea Market Fee: {Rubles.format(item.fleaMarketFee)}</p>
            </div>
          </div>
        </div>
        <div>
          <h2 className="text-lg">Buy For</h2>
          <div className="bg-neutral-700 rounded-md p-3 shadow-md">
            <p>
              {item.buyFor &&
                `${item.buyFor.vendor.name}: ${Rubles.format(
                  item.buyFor.price
                )}`}
            </p>
            <p>Flea Market: {Rubles.format(item.fleaMarket.buyForPrice)}</p>
          </div>
        </div>
        <div>
          <h2 className="text-lg">Sell For</h2>
          <div className="bg-neutral-700 rounded-md p-3 shadow-md">
            <p>
              {item.sellFor &&
                `${item.sellFor.vendor.name}: ${Rubles.format(
                  item.sellFor.price
                )}`}
            </p>
            <p>Flea Market: {Rubles.format(item.fleaMarket.sellForPrice)}</p>
          </div>
        </div>
      </div>
    )
  );
}
