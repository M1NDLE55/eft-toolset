"use client";

import { useState } from "react";
import Accordion from "./accordion";
import { RomanLiteral } from "@/app/lib/roman";
import Link from "next/link";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import { Item } from "@/app/lib/types/item";

export default function CraftsUsing({
  crafts,
}: {
  crafts: Item["craftsUsing"];
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
    <div className="flex flex-col" id="crafts">
      <h2 className="text-lg">Crafts Using</h2>
      {crafts.length === 0 ? (
        <div className="px-3 py-3 shadow bg-secondary text-sm text-[#9a8866]">
          No crafts use this item
        </div>
      ) : (
        <div className="px-3 py-1 shadow bg-secondary flex flex-col">
          {crafts.map(
            (craft, i) =>
              craft && (
                <Accordion
                  key={craft.rewardItems[0]!.item.name! + i}
                  title={
                    <>
                      <span className="border border-[#9a8866] bg-[#2a1800] text-[#9a8866] px-2 mr-2 shrink-0">
                        {craft.station.name + " " + RomanLiteral(craft.level)}
                      </span>
                      <span className="truncate">
                        {craft.rewardItems[0]!.item.name}
                      </span>
                      <span className="text-[#9a8866] text-sm ml-2 shrink-0">
                        ({craft.requiredItems.length} items)
                      </span>
                    </>
                  }
                  isOpen={openIndices.has(i)}
                  setOpenIndex={() => toggleIndex(i)}
                  className={i > 0 && "border-t"}
                >
                  {craft.taskUnlock ? (
                    <p>
                      Must complete task:{" "}
                      <a
                        href={craft.taskUnlock.wikiLink!}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
                      >
                        {craft.taskUnlock.name}
                      </a>
                    </p>
                  ) : (
                    <p className="text-[#9a8866] text-sm">No task requirement</p>
                  )}
                  <p className="pt-1">Required Items:</p>
                  {craft.requiredItems.map(
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
                  {craft.rewardItems.map(
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
