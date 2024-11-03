"use client";

import { Save } from "lucide-react";
import HeadingButton from "@/app/components/item-groups/heading-button";
import SearchWrapper from "@/app/components/global/search/search-wrapper";
import { BaseSyntheticEvent, useState } from "react";
import AddItem from "@/app/components/item-groups/add-item";
import ItemsInGroup from "@/app/components/item-groups/items-in-group";
import { useRouter } from "next/navigation";
import { Group, ItemPreview } from "@/app/lib/types/itemGroups";

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
    <form
      onSubmit={createGroup}
      className="max-w-xl w-full flex flex-col gap-4"
    >
      <div className="w-full flex gap-4 text-xl text-neutral-200 justify-between items-center">
        <h1 className="text-3xl">Create group</h1>
        <HeadingButton>
          <Save />
          Save
        </HeadingButton>
      </div>
      {hasError && <p className="text-red-500 text-lg">{hasError}</p>}
      <div>
        <h2 className="text-neutral-200 text-lg">Group name</h2>
        <input
          name="groupName"
          className="w-full p-2 rounded-md"
          placeholder="Enter group name"
          required
        />
      </div>
      <SearchWrapper handleSelect={(itemName) => setItem(itemName)} />
      {item && (
        <AddItem
          item={item}
          setItem={setItem}
          groupItems={groupItems}
          setGroupItems={setGroupItems}
        />
      )}
      {groupItems.length > 0 && (
        <ItemsInGroup groupItems={groupItems} setGroupItems={setGroupItems} />
      )}
    </form>
  );
}
