"use client";

import { useState } from "react";
import Accordion from "./accordion";
import { RomanLiteral } from "@/app/lib/roman";
import Link from "next/link";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import { Item } from "@/app/lib/types/item";

export default function BartersUsing({
  barters,
}: {
  barters: Item["bartersUsing"];
}) {
  const [openBarterIndex, setOpenBarterIndex] = useState<number | null>(null);

  return (
    barters.length > 0 && (
      <div className="flex flex-col">
        <h2 className="text-lg">Barters Using</h2>
        <div className="bg-neutral-700 rounded-md px-3 py-1 shadow-md flex flex-col">
          {barters.map(
            (barter, i) =>
              barter && (
                <Accordion
                  key={barter.rewardItems[0]!.item.name! + i}
                  title={
                    <>
                      <span className="bg-neutral-800 rounded-full px-2 mr-2">
                        {barter.trader.name + " " + RomanLiteral(barter.level)}
                      </span>
                      {barter.rewardItems[0]!.item.name}
                    </>
                  }
                  isOpen={openBarterIndex === i}
                  setOpenIndex={() =>
                    setOpenBarterIndex((index) => (index === i ? null : i))
                  }
                  className={i > 0 && "border-t"}
                >
                  {barter.taskUnlock ? (
                    <p>
                      Must complete task:{" "}
                      <a
                        href={barter.taskUnlock.wikiLink!}
                        target="blank"
                        className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
                      >
                        {barter.taskUnlock.name}
                      </a>
                    </p>
                  ) : (
                    <p>Not task locked</p>
                  )}
                  <p className="pt-1">Required Items:</p>
                  {barter.requiredItems.map(
                    (item, i) =>
                      item && (
                        <p key={item.item.name! + i}>
                          {item.quantity + " x "}
                          <Link
                            href={{
                              pathname: `/item/${customEncodeURI(
                                item.item.name!
                              )}`,
                            }}
                            className="underline underline-offset-2 text-red-400 hover:underline-offset-4 transition-[text-underline-offset]"
                          >
                            {item.item.name}
                          </Link>
                        </p>
                      )
                  )}
                  <p className="pt-1">Reward Items:</p>
                  {barter.rewardItems.map(
                    (item, i) =>
                      item && (
                        <p key={item.item.name! + i}>
                          {item.quantity + " x "}
                          <Link
                            href={{
                              pathname: `/item/${customEncodeURI(
                                item.item.name!
                              )}`,
                            }}
                            className="underline underline-offset-2 text-green-400 hover:underline-offset-4 transition-[text-underline-offset]"
                          >
                            {item.item.name}
                          </Link>
                        </p>
                      )
                  )}
                </Accordion>
              )
          )}
        </div>
      </div>
    )
  );
}
