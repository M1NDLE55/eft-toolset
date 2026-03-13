import { Rubles } from "@/app/lib/currency";
import Share from "./share";
import Image from "next/image";
import { Item } from "@/app/lib/types/item";

export default function GenericDetails({ item }: { item: Item }) {
  return (
    <>
      <div id="general">
        <div className="flex flex-row justify-between text-lg">
          <h2>General</h2>
          <Share />
        </div>
        <div className="p-3 flex flex-row gap-4 items-start shadow bg-secondary">
          {item.gridImageLink && (
            <Image
              src={item.gridImageLink}
              alt={item.name!}
              height={80}
              width={80}
              className="shrink-0"
            />
          )}
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-xl font-semibold">{item.name}</h1>
            <div className="grid sm:grid-cols-2 sm:gap-4">
              <div>
                <p>
                  Grid size:{" "}
                  <span className="border border-[#9a8866] bg-[#2a1800] text-[#9a8866] px-2">
                    {item.width} × {item.height}
                  </span>
                </p>
                <p>
                  {(item.fleaMarketFee &&
                    `Flea Market Fee: ${Rubles.format(item.fleaMarketFee)}`) ||
                    "Cannot be listed on flea market"}
                </p>
              </div>
              <div>
                {item.sellFor && item.sellFor.length > 0 && (
                  <p>
                    Slot Value:{" "}
                    {Rubles.format(
                      [...item.sellFor].sort(
                        (a, b) => b.priceRUB! - a.priceRUB!
                      )[0].priceRUB! /
                        (item.width * item.height)
                    )}
                  </p>
                )}
                {item.changeLast48hPercent !== null && (
                  <p>
                    48h Change:{" "}
                    <span
                      className={
                        item.changeLast48hPercent >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {item.changeLast48hPercent}%
                    </span>
                  </p>
                )}
              </div>
            </div>
            {item.wikiLink && (
              <a
                href={item.wikiLink}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
              >
                View on Wiki
              </a>
            )}
          </div>
        </div>
      </div>
      <div
        className={`grid grid-cols-1 ${
          item.buyFor &&
          item.buyFor.length > 0 &&
          item.sellFor &&
          item.sellFor.length > 0 &&
          "sm:grid-cols-2"
        } gap-4`}
      >
        {item.buyFor && item.buyFor.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Buy For</h2>
            <div className="p-3 shadow bg-secondary flex-1">
              {[...item.buyFor]
                .sort((a, b) => a.priceRUB! - b.priceRUB!)
                .map((buyFor) => (
                  <p
                    key={`buyFor${buyFor.vendor.name}`}
                    className="flex flex-row justify-between"
                  >
                    <span>{buyFor.vendor.name}</span>
                    <span>{Rubles.format(buyFor.priceRUB!)}</span>
                  </p>
                ))}
            </div>
          </div>
        )}
        {item.sellFor && item.sellFor.length > 0 && (
          <div className="flex flex-col">
            <h2 className="text-lg">Sell For</h2>
            <div className="p-3 shadow bg-secondary flex-1">
              {[...item.sellFor]
                .sort((a, b) => b.priceRUB! - a.priceRUB!)
                .map((sellFor) => (
                  <p
                    key={`sellFor${sellFor.vendor.name}`}
                    className="flex flex-row justify-between"
                  >
                    <span>{sellFor.vendor.name}</span>
                    <span>{Rubles.format(sellFor.priceRUB!)}</span>
                  </p>
                ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
