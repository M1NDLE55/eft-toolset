import { useState, useEffect, useRef } from "react";
import GraphQL from "@/app/features/data/GraphQL";
import { Rubles } from "@/app/features/data/Currency";
import { ChevronDown } from "lucide-react";
import { selectedItemQuery } from "@/app/features/data/Queries";

export default function SelectedItem({ searchParams }) {
  const [item, setItem] = useState(null);
  const [openTaskIndex, setOpenTaskIndex] = useState(null);

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
          usedInTasks: item.usedInTasks.sort((a, b) => {
            if (a.trader.name < b.trader.name) {
              return -1;
            }
            if (a.trader.name > b.trader.name) {
              return 1;
            }
            return a.minPlayerLevel - b.minPlayerLevel;
          }),
        });
      } catch {
        console.log("Error on selected item load");
        setItem(null);
      } finally {
        setOpenTaskIndex(null);
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
        {item.usedInTasks.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Used In Tasks</h2>
            <div className="bg-neutral-700 rounded-md px-3 py-1 shadow-md flex flex-col">
              {item.usedInTasks.map((task, i) => (
                <Accordion
                  key={task.name}
                  task={task}
                  openTaskIndex={openTaskIndex}
                  setOpenTaskIndex={setOpenTaskIndex}
                  i={i}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  );
}

function Accordion({ task, openTaskIndex, setOpenTaskIndex, i }) {
  const content = useRef();

  return (
    <div className="flex flex-col overflow-hidden">
      <div
        className={`flex flex-row justify-between py-2 cursor-pointer ${
          i > 0 && "border-t"
        }`}
        onClick={() => setOpenTaskIndex((index) => (index === i ? null : i))}
      >
        <p className="truncate">
          <span className="bg-neutral-800 rounded-full px-2 mr-2">
            {task.trader.name}
          </span>
          {task.name}
        </p>
        <ChevronDown
          className="shrink-0 transition-rotate ease-in-out duration-500"
          style={
            openTaskIndex === i ? { rotate: "180deg" } : { rotate: "0deg" }
          }
        />
      </div>
      <div
        ref={content}
        className="transition-height ease-in-out duration-500"
        style={
          openTaskIndex === i
            ? { height: content.current.scrollHeight, marginBottom: "12px" }
            : { height: "0px" }
        }
      >
        <div className="flex flex-row justify-between pb-1">
          <p>
            Minimum Player Level:{" "}
            <span className="bg-neutral-800 rounded-full px-2">
              {task.minPlayerLevel}
            </span>
          </p>
          <a
            href={task.wikiLink}
            target="blank"
            className="underline underline-offset-2 text-yellow-500 hover:underline-offset-4 transition-[text-underline-offset]"
          >
            View on Wiki
          </a>
        </div>

        <p>Objectives:</p>
        <ul className="list-disc">
          {task.objectives.map((objective, i) => (
            <li key={task.name + "" + i} className="ml-5">
              {objective.description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
