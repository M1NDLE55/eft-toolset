"use client";

import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";

export default function UsedInTasks({ tasks }) {
  const [openTaskIndex, setOpenTaskIndex] = useState(null);

  return (
    tasks.length > 0 && (
      <div className="flex flex-col">
        <h2 className="text-lg">Used In Tasks</h2>
        <div className="bg-neutral-700 rounded-md px-3 py-1 shadow-md flex flex-col">
          {tasks.map((task, i) => (
            <Accordion
              key={task.name}
              task={task}
              openTaskIndex={openTaskIndex}
              setOpenTaskIndex={setOpenTaskIndex}
              i={i}
            />
          ))}
        </div>
      </div>
    )
  );
}

function Accordion({ task, openTaskIndex, setOpenTaskIndex, i }) {
  const content = useRef();
  const isOpen = openTaskIndex === i;

  return (
    <div className="flex flex-col overflow-hidden">
      <div
        className={`flex flex-row justify-between py-2 cursor-pointer ${
          i > 0 && "border-t"
        }`}
        onClick={() => setOpenTaskIndex((index) => (index === i ? null : i))}
      >
        <p className={`${!isOpen ? "truncate" : ""}`}>
          <span className="bg-neutral-800 rounded-full px-2 mr-2">
            {task.trader.name}
          </span>
          {task.name}
        </p>
        <ChevronDown
          className="shrink-0 transition-rotate ease-in-out duration-500"
          style={isOpen ? { rotate: "180deg" } : { rotate: "0deg" }}
        />
      </div>
      <div
        ref={content}
        className="transition-height ease-in-out duration-500"
        style={
          isOpen
            ? { height: content.current.scrollHeight, marginBottom: "12px" }
            : { height: "0px" }
        }
      >
        <div className="flex flex-col-reverse gap-1 sm:flex-row sm:justify-between pb-1">
          <p>
            Minimum Player Level:{" "}
            <span className="bg-neutral-800 rounded-full px-2">
              {task.minPlayerLevel}
            </span>
          </p>
          <a
            href={task.wikiLink}
            target="blank"
            className="underline underline-offset-2 text-yellow-500 hover:underline-offset-4 transition-[text-underline-offset]"
          >
            View on Wiki
          </a>
        </div>

        <p>Objectives:</p>
        <ul className="list-disc">
          {task.objectives.map((objective, i) => (
            <li key={task.name + "" + i} className="ml-5">
              {objective.description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
