"use client";

import { Group } from "@/app/lib/types/itemGroups";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@apollo/client";
import { ITEMS_IN_GROUP } from "@/app/lib/queries";
import QueryError from "@/app/components/global/error/query-error";
import { getColumns } from "@/app/components/item-groups/table-columns";
import { DataTable } from "@/components/ui/data-table";
import { Item } from "@/app/lib/types/item";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Page() {
  const router = useRouter();
  const groupName = useParams<{ group: string }>().group;
  const [names, setNames] = useState<string[]>([]);
  const { data, loading, error } = useQuery(ITEMS_IN_GROUP, {
    variables: { names: names },
    skip: names.length === 0,
  });

  function handleRemove(itemName: string) {
    const groups = localStorage.getItem("item-groups");

    if (!groups) {
      console.warn("No groups found");
      return;
    }

    const updatedGroups = (JSON.parse(groups) as Group[]).map((g) => {
      if (g.name === groupName) {
        const updatedItems = g.items.filter((name) => name !== itemName);

        setNames(updatedItems);

        return {
          name: g.name,
          items: updatedItems,
        };
      }
      return g;
    });

    localStorage.setItem("item-groups", JSON.stringify(updatedGroups));
  }

  function handleDelete() {
    const groups = localStorage.getItem("item-groups");

    if (!groups) {
      console.warn("No groups found");
      return;
    }

    const updatedGroups = (JSON.parse(groups) as Group[]).filter(
      (g) => g.name !== groupName
    );

    localStorage.setItem("item-groups", JSON.stringify(updatedGroups));

    router.push("/item-groups");
  }

  useEffect(() => {
    const groups = localStorage.getItem("item-groups");

    if (!groups) notFound();

    const group = (JSON.parse(groups) as Group[]).find(
      (group) => group.name.toLowerCase() === groupName.toLowerCase()
    );

    if (!group) notFound();

    setNames(group.items);
  }, []);

  if (loading || !data)
    return (
      <div className="max-w-4xl w-full flex flex-col gap-4">
        <h1 className="text-3xl">{groupName}</h1>
        <div className="w-full animate-pulse rounded-md">
          <div className="w-full py-8 bg-neutral-200 dark:bg-neutral-600"></div>
          <div className="w-full py-8 bg-neutral-100 dark:bg-neutral-500"></div>
          <div className="w-full py-8 bg-neutral-200 dark:bg-neutral-600"></div>
          <div className="w-full py-8 bg-neutral-100 dark:bg-neutral-500"></div>
          <div className="w-full py-8 bg-neutral-200 dark:bg-neutral-600"></div>
        </div>
      </div>
    );

  if (error) return <QueryError error={error} />;

  const columns = getColumns(handleRemove);

  return (
    <div className="max-w-4xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl justify-between items-center">
        <h1 className="text-3xl">{groupName}</h1>
        <AlertDialog>
          <AlertDialogTrigger className="flex gap-1">
            <Button variant={"destructive"}>Delete</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete this
                item group.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {data.items.length > 0 ? (
        <DataTable
          columns={columns}
          data={data.items as Item[]}
          sort={{ column: "name", title: "item" }}
        />
      ) : (
        <p className="p-3 w-full rounded-md border border-neutral-600 text-xl text-neutral-600">
          No items in group
        </p>
      )}
    </div>
  );
}
