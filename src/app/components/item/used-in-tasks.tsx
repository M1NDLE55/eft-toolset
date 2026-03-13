"use client";

import { useState } from "react";
import Accordion from "./accordion";
import { Item } from "@/app/lib/types/item";

export default function UsedInTasks({ tasks }: { tasks: Item["usedInTasks"] }) {
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
    <div className="flex flex-col" id="tasks">
      <h2 className="text-lg">Used In Tasks</h2>
      {tasks.length === 0 ? (
        <div className="px-3 py-3 shadow bg-secondary text-sm text-[#9a8866]">
          This item is not used in any tasks
        </div>
      ) : (
        <div className="px-3 py-1 flex flex-col shadow bg-secondary">
          {tasks.map(
            (task, i) =>
              task && (
                <Accordion
                  key={task.name}
                  title={
                    <>
                      <span className="border border-[#9a8866] bg-[#2a1800] text-[#9a8866] px-2 mr-2">
                        {task.trader.name}
                      </span>
                      {task.name}
                    </>
                  }
                  isOpen={openIndices.has(i)}
                  setOpenIndex={() => toggleIndex(i)}
                  className={i > 0 && "border-t"}
                >
                  <div className="flex flex-col-reverse gap-1 sm:flex-row sm:justify-between pb-1">
                    <p>
                      Minimum Player Level:{" "}
                      <span className="border border-[#9a8866] bg-[#2a1800] text-[#9a8866] px-2">
                        {task.minPlayerLevel}
                      </span>
                    </p>
                    {task.wikiLink && (
                      <a
                        href={task.wikiLink}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 text-yellow-400 hover:underline-offset-4 transition-[text-underline-offset]"
                      >
                        View on Wiki
                      </a>
                    )}
                  </div>
                  <p>Objectives:</p>
                  <ul className="list-disc">
                    {task.objectives.map(
                      (objective, i) =>
                        objective && (
                          <li key={task.name + "" + i} className="ml-5">
                            {objective.description}
                          </li>
                        )
                    )}
                  </ul>
                </Accordion>
              )
          )}
        </div>
      )}
    </div>
  );
}
