"use client";

import { Group } from "@/app/lib/types/itemGroups";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";
import { useItemsInGroup } from "@/app/lib/cache/hooks";
import { Pencil, Plus } from "lucide-react";
import SearchWrapper from "@/app/components/global/search/search-wrapper";
import AddItem from "@/app/components/item-groups/add-item";
import { ItemPreview } from "@/app/lib/types/itemGroups";

export default function Page() {
  const router = useRouter();
  const groupName = customDecodeURI(useParams<{ group: string }>().group);
  const [names, setNames] = useState<string[]>([]);
  const { items, loading } = useItemsInGroup(names);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(groupName);
  const [renameError, setRenameError] = useState("");

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [searchItem, setSearchItem] = useState("");
  const [addItemPreviews, setAddItemPreviews] = useState<ItemPreview[]>([]);

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

  function handleRename() {
    setRenameError("");
    const newName = renameValue.trim();

    if (!newName) {
      setRenameError("Name cannot be empty");
      return;
    }

    const groups: Group[] =
      JSON.parse(localStorage.getItem("item-groups") as string) || [];

    if (
      newName !== groupName &&
      groups.find((g) => g.name.toLowerCase() === newName.toLowerCase())
    ) {
      setRenameError("A group with this name already exists");
      return;
    }

    const updated = groups.map((g) => {
      if (g.name === groupName) {
        return { name: newName, items: g.items };
      }
      return g;
    });

    localStorage.setItem("item-groups", JSON.stringify(updated));
    setRenameOpen(false);
    router.push(`/item-groups/${customEncodeURI(newName)}`);
  }

  function handleAddItem(itemName: string, gridImageLink: string) {
    const groups: Group[] =
      JSON.parse(localStorage.getItem("item-groups") as string) || [];

    const updated = groups.map((g) => {
      if (g.name === groupName) {
        if (g.items.includes(itemName)) return g;
        return { name: g.name, items: [...g.items, itemName] };
      }
      return g;
    });

    localStorage.setItem("item-groups", JSON.stringify(updated));
    setNames((prev) => (prev.includes(itemName) ? prev : [...prev, itemName]));
    setSearchItem("");
    setAddItemOpen(false);
  }

  useEffect(() => {
    const groups = localStorage.getItem("item-groups");

    if (!groups) notFound();

    const group = (JSON.parse(groups) as Group[]).find(
      (group) => group.name.toLowerCase() === groupName.toLowerCase()
    );

    if (!group) notFound();

    setNames(group.items);
  }, [groupName]);

  if (loading)
    return (
      <div className="max-w-4xl w-full flex flex-col gap-4">
        <h1 className="text-3xl text-[#9a8866] uppercase tracking-widest font-black">{groupName}</h1>
        <div className="flex w-full flex-col gap-3">
          <Skeleton className="w-full py-8" />
          <Skeleton className="w-full py-8" />
          <Skeleton className="w-full py-8" />
          <Skeleton className="w-full py-8" />
        </div>
      </div>
    );

  const columns = getColumns(handleRemove);

  return (
    <div className="max-w-4xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl justify-between items-center">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl text-[#9a8866] uppercase tracking-widest font-black">{groupName}</h1>
          <Dialog open={renameOpen} onOpenChange={(open) => { setRenameOpen(open); if (open) { setRenameValue(groupName); setRenameError(""); } }}>
            <DialogTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <Pencil size={16} />
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename group</DialogTitle>
                <DialogDescription>Enter a new name for this group.</DialogDescription>
              </DialogHeader>
              {renameError && <p className="text-red-500 text-sm">{renameError}</p>}
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRename(); } }}
                autoFocus
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
                <Button onClick={handleRename}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex gap-2">
          <Dialog open={addItemOpen} onOpenChange={(open) => { setAddItemOpen(open); if (!open) { setSearchItem(""); setAddItemPreviews([]); } }}>
            <DialogTrigger asChild>
              <Button>
                <Plus size={16} />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Add item to group</DialogTitle>
                <DialogDescription>Search for an item to add.</DialogDescription>
              </DialogHeader>
              <SearchWrapper handleSelect={(itemName) => setSearchItem(itemName)} excludeNames={names} />
              {searchItem && (
                <AddItem
                  item={searchItem}
                  setItem={setSearchItem}
                  groupItems={addItemPreviews}
                  setGroupItems={setAddItemPreviews}
                  onAdd={handleAddItem}
                  existingNames={names}
                />
              )}
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger className="flex gap-1">
              <Button variant={"destructive"}>Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete
                  this item group.
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
      </div>
      {items.length > 0 ? (
        <DataTable
          columns={columns}
          data={items as unknown as Item[]}
          sort={{ column: "name", title: "item" }}
        />
      ) : (
        <p className="p-3 w-full border text-xl">
          No items in group
        </p>
      )}
    </div>
  );
}
