"use client";

import { ReactNode, useEffect, useState } from "react";
import GroupSelector from "../components/item-groups/GroupSelector";
import GroupEditor from "../components/item-groups/GroupEditor";
import { Group } from "./types";
import { SquareMousePointer, SquarePlus, EditIcon } from "lucide-react";

export default function Page() {
  const [isEditing, setIsEditing] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  if (!localStorage.getItem("item-groups")) {
    localStorage.setItem("item-groups", JSON.stringify([]));
  }

  function handleEdit() {
    setIsEditing((e) => !e);
  }

  function handleSelect() {
    setIsEditing(false);
  }

  function handleDelete(groupName: string) {
    //todo confirmation
    const updatedGroups = groups.filter((group) => group.name !== groupName);
    setGroups(updatedGroups);
    localStorage.setItem("item-groups", JSON.stringify(updatedGroups));
  }

  useEffect(() => {
    setGroups(JSON.parse(localStorage.getItem("item-groups") as string));
  }, []);

  return (
    <>
      <div className="w-full flex gap-4 text-xl text-neutral-200 justify-between items-center">
        <h1 className="text-3xl">Item Groups</h1>
        <div className="flex flex-row gap-4 items-center">
          <HeadingButton flag={!isEditing} onClick={handleSelect}>
            <SquareMousePointer />
            Select
          </HeadingButton>
          <HeadingButton onClick={() => {}}>
            <SquarePlus />
            Add
          </HeadingButton>
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
              handleDelete={handleDelete}
            />
          )
        )
      ) : (
        <p className="p-3 w-full rounded-md border border-neutral-600 text-xl text-neutral-600">
          No item groups
        </p>
      )}
    </>
  );
}

function HeadingButton({
  flag = false,
  onClick,
  children,
}: {
  flag?: boolean;
  onClick: any;
  children: ReactNode;
}) {
  return (
    <button
      className={`flex flex-row items-center gap-1 hover:text-yellow-400 transition-colors ${
        flag && "text-green-400"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
