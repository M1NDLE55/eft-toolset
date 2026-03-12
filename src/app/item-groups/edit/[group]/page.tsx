"use client";

import { BaseSyntheticEvent, useEffect, useState } from "react";
import { notFound, useParams, useRouter } from "next/navigation";
import { Group, ItemPreview } from "@/app/lib/types/itemGroups";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";
import { Skeleton } from "@/components/ui/skeleton";
import CreateOrEditForm from "@/app/components/item-groups/create-or-edit-form";
import { useItemsInGroup } from "@/app/lib/cache/hooks";

export default function Page() {
  const router = useRouter();
  const ogGroupName = customDecodeURI(useParams<{ group: string }>().group);

  const [names, setNames] = useState<string[]>([]);
  const [item, setItem] = useState("");
  const [groupItems, setGroupItems] = useState<ItemPreview[]>([]);
  const [hasError, setHasError] = useState("");

  const { items, loading } = useItemsInGroup(names);

  function editGroup(e: BaseSyntheticEvent) {
    e.preventDefault();
    setHasError("");

    const formData = new FormData(e.target);

    const groupName =
      (formData.get("groupName") as FormDataEntryValue).toString() ||
      ogGroupName;

    const groups: Group[] =
      JSON.parse(localStorage.getItem("item-groups") as string) || [];

    if (
      groupName !== ogGroupName &&
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

    const updated = groups.map((g) => {
      if (g.name === ogGroupName) {
        return {
          name: groupName,
          items: groupItems.map((item) => item.name),
        };
      }

      return g;
    });

    localStorage.setItem("item-groups", JSON.stringify(updated));

    router.push(`/item-groups/${customEncodeURI(groupName)}`);
  }

  useEffect(() => {
    if (items.length > 0) {
      const previews = items.map((item) => ({
        name: item.name!,
        gridImageLink: item.gridImageLink!,
      }));
      setGroupItems(previews);
    }
  }, [items]);

  useEffect(() => {
    const groups = localStorage.getItem("item-groups");

    if (!groups) notFound();

    const group = (JSON.parse(groups) as Group[]).find(
      (group) => group.name.toLowerCase() === ogGroupName.toLowerCase()
    );

    if (!group) notFound();

    setNames(group.items);
  }, []);

  if (loading) {
    return (
      <div className="max-w-xl w-full flex flex-col gap-4">
        <h1 className="text-3xl text-[#9a8866] uppercase tracking-widest font-black">Edit group</h1>
        <Skeleton className="w-full h-10" />
        <Skeleton className="w-full h-10" />
        <Skeleton className="w-full h-[88px]" />
      </div>
    );
  }

  return (
    <CreateOrEditForm
      onSubmit={editGroup}
      error={hasError}
      item={item}
      setItem={setItem}
      groupItems={groupItems}
      setGroupItems={setGroupItems}
      groupName={ogGroupName}
      editForm
    />
  );
}
