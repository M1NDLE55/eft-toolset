"use client";

import { useEffect, useState } from "react";
import GroupSelector from "../components/item-groups/group-selector";
import { Group } from "../lib/types/itemGroups";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
      <div className="w-full flex gap-4 text-xl justify-between items-center">
        <h1 className="text-3xl">Item Groups</h1>
        <Button variant={"outline"} asChild>
          <Link
            href={{ pathname: "/item-groups/create" }}
            className={`flex flex-row items-center gap-1`}
          >
            Create
          </Link>
        </Button>
      </div>
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[52px] w-full" />
          <Skeleton className="h-[52px] w-full" />
          <Skeleton className="h-[52px] w-full" />
        </div>
      ) : groups.length > 0 ? (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <GroupSelector key={group.name} group={group} />
          ))}
        </div>
      ) : (
        <p className="p-3 w-full rounded-md border border-neutral-200 dark:border-neutral-600 text-xl">
          No item groups
        </p>
      )}
    </div>
  );
}
