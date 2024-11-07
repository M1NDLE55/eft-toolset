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
  const [openCraftIndex, setOpenCraftIndex] = useState<number | null>(null);

  return (
    crafts.length > 0 && (
      <div className="flex flex-col">
        <h2 className="text-lg">Crafts Using</h2>
        <div className="rounded-md px-3 py-1 shadow bg-secondary flex flex-col">
          {crafts.map(
            (craft, i) =>
              craft && (
                <Accordion
                  key={craft.rewardItems[0]!.item.name! + i}
                  title={
                    <>
                      <span className="border border-yellow-500 bg-yellow-500 dark:bg-inherit rounded-full px-2 mr-2">
                        {craft.station.name + " " + RomanLiteral(craft.level)}
                      </span>
                      {craft.rewardItems[0]!.item.name}
                    </>
                  }
                  isOpen={openCraftIndex === i}
                  setOpenIndex={() =>
                    setOpenCraftIndex((index) => (index === i ? null : i))
                  }
                  className={i > 0 && "border-t"}
                >
                  {craft.taskUnlock ? (
                    <p>
                      Must complete task:{" "}
                      <a
                        href={craft.taskUnlock.wikiLink!}
                        target="blank"
                        className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
                      >
                        {craft.taskUnlock.name}
                      </a>
                    </p>
                  ) : (
                    <p>Not task locked</p>
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
                            className="underline underline-offset-2 text-red-400 hover:underline-offset-4 transition-[text-underline-offset]"
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
      </div>
    )
  );
}
