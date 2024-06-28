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
                priceRUB
              }         
              sellFor{
                vendor {
                  name
                }
                priceRUB
              }   
              usedInTasks {
                name
                minPlayerLevel
                trader {
                    name
                }
                objectives {
                    description                  
                }
                wikiLink         
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
        const fleaMarket =
          (item.fleaMarketFee &&
            item.sellFor.find(
              (sellFor) => sellFor.vendor.name === "Flea Market"
            )) ||
          null;

        setItem({
          name: item.name,
          fleaMarketFee: item.fleaMarketFee,
          gridImageLink: item.gridImageLink,
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
          usedInTasks: item.usedInTasks,
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
              <p>
                {(item.fleaMarketFee &&
                  `Flea Market Fee: ${Rubles.format(item.fleaMarketFee)}`) ||
                  "Cannot be listed on flea market"}
              </p>
            </div>
          </div>
        </div>
        <div
          className={`grid grid-cols-1 ${
            item.buyFor.length > 0 &&
            item.sellFor.length > 0 &&
            "sm:grid-cols-2"
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
        <div>
          {JSON.stringify(
            item.usedInTasks.sort((a, b) => {
              if (a.trader.name < b.trader.name) {
                return -1;
              }
              if (a.trader.name > b.trader.name) {
                return 1;
              }
              return a.minPlayerLevel - b.minPlayerLevel;
            })
          )}
        </div>
      </div>
    )
  );
}
