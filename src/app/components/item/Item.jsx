"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { Rubles } from "@/app/features/data/Currency";

export default function Item({ itemName, parentResponse }) {
  const [response, setResponse] = useState(null);
  const [openTaskIndex, setOpenTaskIndex] = useState(null);

  useEffect(() => {
    if (parentResponse) {
      setResponse(parentResponse);
    }
  }, [parentResponse]);

  if (!response) {
    return;
  }

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

  const item = response.data.items[0];

  const fleaMarket =
    (item.fleaMarketFee &&
      item.sellFor.find((sellFor) => sellFor.vendor.name === "Flea Market")) ||
    null;

  const newItem = {
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

  return (
    <div className="flex flex-col gap-4 text-white">
      <div>
        <h2 className="text-lg">Item</h2>
        <div className="bg-neutral-700 rounded-md p-3 flex flex-row gap-4 items-center shadow-md">
          {/* eslint-disable-next-line */}
          <img
            src={newItem.gridImageLink}
            alt={`Image of an ${itemName}`}
            height={64}
            width={64}
          />
          <div>
            <p>Name: {itemName}</p>
            <p>
              {(newItem.fleaMarketFee &&
                `Flea Market Fee: ${Rubles.format(newItem.fleaMarketFee)}`) ||
                "Cannot be listed on flea market"}
            </p>
            <a
              href={newItem.wikiLink}
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
          newItem.buyFor.length > 0 &&
          newItem.sellFor.length > 0 &&
          "sm:grid-cols-2"
        } gap-4`}
      >
        {newItem.buyFor.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Buy For</h2>
            <div className="bg-neutral-700 rounded-md p-3 shadow-md flex-1">
              {newItem.buyFor.map((buyFor) => (
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
        {newItem.sellFor.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Sell For</h2>
            <div className="bg-neutral-700 rounded-md p-3 shadow-md flex-1">
              {newItem.sellFor.map((sellFor) => (
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
      {newItem.usedInTasks.length > 0 && (
        <div className="flex flex-col">
          <h2 className="text-lg">Used In Tasks</h2>
          <div className="bg-neutral-700 rounded-md px-3 py-1 shadow-md flex flex-col">
            {newItem.usedInTasks.map((task, i) => (
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
  );
}

function Accordion({ task, openTaskIndex, setOpenTaskIndex, i }) {
  const content = useRef();
  const isOpen = openTaskIndex === i;

  return (
    <div className="flex flex-col overflow-hidden">
      <div
        className={`flex flex-row justify-between py-2 cursor-pointer ${
          i > 0 && "border-t"
        }`}
        onClick={() => setOpenTaskIndex((index) => (index === i ? null : i))}
      >
        <p className={`${!isOpen ? "truncate" : ""}`}>
          <span className="bg-neutral-800 rounded-full px-2 mr-2">
            {task.trader.name}
          </span>
          {task.name}
        </p>
        <ChevronDown
          className="shrink-0 transition-rotate ease-in-out duration-500"
          style={isOpen ? { rotate: "180deg" } : { rotate: "0deg" }}
        />
      </div>
      <div
        ref={content}
        className="transition-height ease-in-out duration-500"
        style={
          isOpen
            ? { height: content.current.scrollHeight, marginBottom: "12px" }
            : { height: "0px" }
        }
      >
        <div className="flex flex-col-reverse gap-1 sm:flex-row sm:justify-between pb-1">
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