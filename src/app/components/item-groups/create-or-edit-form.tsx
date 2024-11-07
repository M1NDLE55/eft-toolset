"use client";

import SearchWrapper from "@/app/components/global/search/search-wrapper";
import { BaseSyntheticEvent, Dispatch, SetStateAction } from "react";
import AddItem from "@/app/components/item-groups/add-item";
import ItemsInGroup from "@/app/components/item-groups/items-in-group";
import { ItemPreview } from "@/app/lib/types/itemGroups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CreateOrEditForm({
  onSubmit,
  error,
  item,
  setItem,
  groupItems,
  setGroupItems,
  groupName = "",
  editForm = false,
}: {
  onSubmit: (e: BaseSyntheticEvent) => void;
  error: string;
  item: string;
  setItem: Dispatch<SetStateAction<string>>;
  groupItems: ItemPreview[];
  setGroupItems: Dispatch<SetStateAction<ItemPreview[]>>;
  groupName?: string;
  editForm?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="max-w-xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl justify-between items-center">
        <h1 className="text-3xl">{editForm ? "Edit" : "Create"} group</h1>
        <Button>Save</Button>
      </div>
      {error && <p className="text-red-500 text-lg">{error}</p>}
      <div>
        <h2 className="text-lg">Group name</h2>
        <Input
          name="groupName"
          className="w-full p-2 rounded-md"
          placeholder={groupName || "Enter group name"}
          required={!editForm}
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
