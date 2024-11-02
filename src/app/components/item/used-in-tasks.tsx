"use client";

import { useState } from "react";
import Accordion from "./accordion";
import { Item } from "@/app/lib/types/item";

export default function UsedInTasks({ tasks }: { tasks: Item["usedInTasks"] }) {
  const [openTaskIndex, setOpenTaskIndex] = useState<number | null>(null);

  return (
    tasks.length > 0 && (
      <div className="flex flex-col">
        <h2 className="text-lg">Used In Tasks</h2>
        <div className="bg-neutral-700 rounded-md px-3 py-1 shadow-md flex flex-col">
          {tasks.map(
            (task, i) =>
              task && (
                <Accordion
                  key={task.name}
                  title={
                    <>
                      <span className="bg-neutral-800 rounded-full px-2 mr-2">
                        {task.trader.name}
                      </span>
                      {task.name}
                    </>
                  }
                  isOpen={openTaskIndex === i}
                  setOpenIndex={() =>
                    setOpenTaskIndex((index) => (index === i ? null : i))
                  }
                  className={i > 0 && "border-t"}
                >
                  <div className="flex flex-col-reverse gap-1 sm:flex-row sm:justify-between pb-1">
                    <p>
                      Minimum Player Level:{" "}
                      <span className="bg-neutral-800 rounded-full px-2">
                        {task.minPlayerLevel}
                      </span>
                    </p>
                    {task.wikiLink && (
                      <a
                        href={task.wikiLink}
                        target="blank"
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
      </div>
    )
  );
}
