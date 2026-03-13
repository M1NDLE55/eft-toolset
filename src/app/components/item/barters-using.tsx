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
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  const toggleIndex = (i: number) => {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="flex flex-col" id="barters">
      <h2 className="text-lg">Barters Using</h2>
      {barters.length === 0 ? (
        <div className="px-3 py-3 shadow bg-secondary text-sm text-[#9a8866]">
          No barters use this item
        </div>
      ) : (
        <div className="px-3 py-1 shadow bg-secondary flex flex-col">
          {barters.map(
            (barter, i) =>
              barter && (
                <Accordion
                  key={barter.rewardItems[0]!.item.name! + i}
                  title={
                    <>
                      <span className="border border-[#9a8866] bg-[#2a1800] text-[#9a8866] px-2 mr-2 shrink-0">
                        {barter.trader.name + " " + RomanLiteral(barter.level)}
                      </span>
                      <span className="truncate">
                        {barter.rewardItems[0]!.item.name}
                      </span>
                      <span className="text-[#9a8866] text-sm ml-2 shrink-0">
                        ({barter.requiredItems.length} items)
                      </span>
                    </>
                  }
                  isOpen={openIndices.has(i)}
                  setOpenIndex={() => toggleIndex(i)}
                  className={i > 0 && "border-t"}
                >
                  {barter.taskUnlock ? (
                    <p>
                      Must complete task:{" "}
                      <a
                        href={barter.taskUnlock.wikiLink!}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
                      >
                        {barter.taskUnlock.name}
                      </a>
                    </p>
                  ) : (
                    <p className="text-[#9a8866] text-sm">No task requirement</p>
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
                            className="underline underline-offset-2 text-[#9a8866] hover:text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset,color]"
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
      )}
    </div>
  );
}
