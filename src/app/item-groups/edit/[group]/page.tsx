"use client";

import { BaseSyntheticEvent, useEffect, useState } from "react";
import { notFound, useParams, useRouter } from "next/navigation";
import { Group, ItemPreview } from "@/app/lib/types/itemGroups";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";
import { useQuery } from "@apollo/client";
import { ITEMS_IN_GROUP } from "@/app/lib/queries";
import { Skeleton } from "@/components/ui/skeleton";
import QueryError from "@/app/components/global/error/query-error";
import CreateOrEditForm from "@/app/components/item-groups/create-or-edit-form";

export default function Page() {
  const router = useRouter();
  const ogGroupName = customDecodeURI(useParams<{ group: string }>().group);

  const [names, setNames] = useState<string[]>([]);
  const [item, setItem] = useState("");
  const [groupItems, setGroupItems] = useState<ItemPreview[]>([]);
  const [hasError, setHasError] = useState("");

  const { data, loading, error } = useQuery(ITEMS_IN_GROUP, {
    variables: { names: names },
    skip: names.length === 0,
  });

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
    if (data) {
      const items = data.items.map((item) => ({
        name: item!.name!,
        gridImageLink: item!.gridImageLink!,
      }));
      setGroupItems(items);
    }
  }, [data]);

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
        <h1 className="text-3xl">Edit group</h1>
        <Skeleton className="w-full h-10" />
        <Skeleton className="w-full h-10" />
        <Skeleton className="w-full h-[88px]" />
      </div>
    );
  }

  if (error) {
    return <QueryError error={error} />;
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
