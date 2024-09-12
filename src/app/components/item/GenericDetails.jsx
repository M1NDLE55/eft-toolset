import { Rubles } from "@/app/lib/Currency";
import Share from "./Share";
import Image from "next/image";

export default function GenericDetails({ item, itemName }) {
  return (
    <>
      <div>
        <div className="flex flex-row justify-between text-lg">
          <h2>General</h2>
          <Share />
        </div>
        <div className="bg-neutral-700 rounded-md p-3 flex flex-row gap-4 items-center shadow-md">
          <Image
            src={item.gridImageLink}
            alt={itemName}
            height={64}
            width={64}
          />
          <div>
            <div className="grid sm:grid-cols-2 sm:gap-4">
              <div>
                <p>Name: {itemName}</p>
                <p>
                  {(item.fleaMarketFee !== null &&
                    `Flea Market Fee: ${Rubles.format(item.fleaMarketFee)}`) ||
                    "Cannot be listed on flea market"}
                </p>
              </div>
              <div>
                {item.sellFor.length > 0 && (
                  <p>
                    Slot Value:{" "}
                    {Rubles.format(item.sellFor[0].priceRUB / item.slots)}
                  </p>
                )}
                {item.changeLast48hPercent !== null && (
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
            <a
              href={item.wikiLink}
              target="blank"
              className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
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
    </>
  );
}
