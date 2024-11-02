import { Rubles } from "@/app/lib/currency";
import Share from "./share";
import Image from "next/image";
import { Item } from "@/app/lib/types/item";

export default function GenericDetails({ item }: { item: Item }) {
  return (
    <>
      <div>
        <div className="flex flex-row justify-between text-lg">
          <h2>General</h2>
          <Share />
        </div>
        <div className="bg-neutral-700 rounded-md p-3 flex flex-row gap-4 items-center shadow-md">
          {item.gridImageLink && (
            <Image
              src={item.gridImageLink}
              alt={item.name!}
              height={64}
              width={64}
            />
          )}
          <div>
            <div className="grid sm:grid-cols-2 sm:gap-4">
              <div>
                <p>Name: {item.name}</p>
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
                      item.sellFor[0].priceRUB! / (item.width * item.height)
                    )}
                  </p>
                )}
                {item.changeLast48hPercent && (
                  <p>
                    48h Change:{" "}
                    <span
                      className={`${
                        item.changeLast48hPercent >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
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
                target="blank"
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
            <div className="bg-neutral-700 rounded-md p-3 shadow-md flex-1">
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
            <div className="bg-neutral-700 rounded-md p-3 shadow-md flex-1">
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
