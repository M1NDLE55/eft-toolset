"use client";

import { useEffect, useState } from "react";
import GroupSelector from "../components/item-groups/GroupSelector";
import GroupEditor from "../components/item-groups/GroupEditor";
import { Group } from "../components/item-groups/types";
import { SquareMousePointer, SquarePlus, EditIcon } from "lucide-react";
import Link from "next/link";
import HeadingButton from "../components/item-groups/HeadingButton";

export default function Page() {
  const [isEditing, setIsEditing] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  function handleEdit() {
    setIsEditing((e) => !e);
  }

  function handleSelect() {
    setIsEditing(false);
  }

  useEffect(() => {
    if (!localStorage.getItem("item-groups")) {
      localStorage.setItem("item-groups", "[]");
    }

    setGroups(JSON.parse(localStorage.getItem("item-groups") as string));
  }, []);

  return (
    <div className="max-w-xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl text-neutral-200 justify-between items-center">
        <h1 className="text-3xl">Item Groups</h1>
        <div className="flex flex-row gap-4 items-center">
          <HeadingButton flag={!isEditing} onClick={handleSelect}>
            <SquareMousePointer />
            Select
          </HeadingButton>
          <Link
            href={{ pathname: "/item-groups/create" }}
            className={`flex flex-row items-center gap-1 hover:text-yellow-400 transition-colors`}
          >
            <SquarePlus />
            Create
          </Link>
          {groups.length > 0 && (
            <HeadingButton flag={isEditing} onClick={handleEdit}>
              <EditIcon />
              Edit
            </HeadingButton>
          )}
        </div>
      </div>
      {groups.length > 0 ? (
        groups.map((group) =>
          !isEditing ? (
            <GroupSelector key={group.name} group={group} />
          ) : (
            <GroupEditor
              key={group.name}
              group={group}
              groups={groups}
              setGroups={setGroups}
            />
          )
        )
      ) : (
        <p className="p-3 w-full rounded-md border border-neutral-600 text-xl text-neutral-600">
          No item groups
        </p>
      )}
    </div>
  );
}
