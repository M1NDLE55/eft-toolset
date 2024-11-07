"use client";

import { BaseSyntheticEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Group, ItemPreview } from "@/app/lib/types/itemGroups";
import CreateOrEditForm from "@/app/components/item-groups/create-or-edit-form";

export default function Page() {
  const [item, setItem] = useState("");
  const [groupItems, setGroupItems] = useState<ItemPreview[]>([]);
  const [hasError, setHasError] = useState("");
  const router = useRouter();

  function createGroup(e: BaseSyntheticEvent) {
    e.preventDefault();
    setHasError("");

    const formData = new FormData(e.target);

    const groupName = (
      formData.get("groupName") as FormDataEntryValue
    ).toString();

    const groups: Group[] =
      JSON.parse(localStorage.getItem("item-groups") as string) || [];

    if (
      groups.find(
        (group) => group.name.toLowerCase() === groupName.toLowerCase()
      )
    ) {
      setHasError("A group with this name already exists*");
      return;
    }

    if (groupItems.length === 0) {
      setHasError("Add at least 1 item*");
      return;
    }

    localStorage.setItem(
      "item-groups",
      JSON.stringify([
        ...groups,
        {
          name: groupName,
          items: groupItems.map((item) => item.name),
        },
      ])
    );

    router.push("/item-groups");
  }

  return (
    <CreateOrEditForm
      onSubmit={createGroup}
      error={hasError}
      item={item}
      setItem={setItem}
      groupItems={groupItems}
      setGroupItems={setGroupItems}
    />
  );
}
