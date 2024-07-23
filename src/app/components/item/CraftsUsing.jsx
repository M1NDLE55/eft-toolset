"use client";

import { useState } from "react";
import Accordion from "./Accordion";
import { RomanLiteral } from "@/app/lib/Roman";
import Link from "next/link";
import { customEncodeURI } from "@/app/lib/URIEncoding";

export default function CraftsUsing({ crafts }) {
  const [openCraftIndex, setOpenCraftIndex] = useState(null);

  return (
    crafts.length > 0 && (
      <div className="flex flex-col">
        <h2 className="text-lg">Crafts Using</h2>
        <div className="bg-neutral-700 rounded-md px-3 py-1 shadow-md flex flex-col">
          {crafts.map((craft, i) => (
            <Accordion
              key={craft.rewardItems[0].item.name + i}
              title={
                <>
                  <span className="bg-neutral-800 rounded-full px-2 mr-2">
                    {craft.station.name + " " + RomanLiteral(craft.level)}
                  </span>
                  {craft.rewardItems[0].item.name}
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
                    href={craft.taskUnlock.wikiLink}
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
              {craft.requiredItems.map((item, i) => (
                <p key={item.item.name + i}>
                  {item.quantity + " x "}
                  <Link
                    href={{
                      pathname: `/item/${customEncodeURI(item.item.name)}`,
                    }}
                    className="underline underline-offset-2 text-red-400 hover:underline-offset-4 transition-[text-underline-offset]"
                  >
                    {item.item.name}
                  </Link>
                </p>
              ))}
              <p className="pt-1">Reward Items:</p>
              {craft.rewardItems.map((item, i) => (
                <p key={item.item.name + i}>
                  {item.quantity + " x "}
                  <Link
                    href={{
                      pathname: `/item/${customEncodeURI(item.item.name)}`,
                    }}
                    className="underline underline-offset-2 text-green-400 hover:underline-offset-4 transition-[text-underline-offset]"
                  >
                    {item.item.name}
                  </Link>
                </p>
              ))}
            </Accordion>
          ))}
        </div>
      </div>
    )
  );
}
