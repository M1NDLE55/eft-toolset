"use client";

import { useEffect, useState } from "react";
import GroupSelector from "../components/item-groups/group-selector";
import { Group } from "../lib/types/itemGroups";
import { SquarePlus } from "lucide-react";
import Link from "next/link";

export default function Page() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (!localStorage.getItem("item-groups")) {
      localStorage.setItem("item-groups", "[]");
    }

    setGroups(JSON.parse(localStorage.getItem("item-groups") as string));
    setLoading(false);
  }, []);

  return (
    <div className="max-w-xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl text-neutral-200 justify-between items-center">
        <h1 className="text-3xl">Item Groups</h1>
        <Link
          href={{ pathname: "/item-groups/create" }}
          className={`flex flex-row items-center gap-1 hover:text-yellow-400 transition-colors`}
        >
          <SquarePlus />
          Create
        </Link>
      </div>
      {loading ? (
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-[52px] w-full rounded-md bg-neutral-500"></div>
          <div className="h-[52px] w-full rounded-md bg-neutral-500"></div>
          <div className="h-[52px] w-full rounded-md bg-neutral-500"></div>
        </div>
      ) : groups.length > 0 ? (
        groups.map((group) => <GroupSelector key={group.name} group={group} />)
      ) : (
        <p className="p-3 w-full rounded-md border border-neutral-600 text-xl text-neutral-600">
          No item groups
        </p>
      )}
    </div>
  );
}
