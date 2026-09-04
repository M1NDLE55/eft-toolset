"use client";

import { useParams, useRouter } from "next/navigation";
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
import { listGroups, saveGroups } from "@/app/lib/item-groups/store";
import {
  MAX_GROUP_ITEMS,
  MAX_GROUP_NAME_LENGTH,
} from "@/app/lib/item-groups/limits";
import { LocalMissing } from "@/components/local-missing";

export default function Page() {
  const router = useRouter();
  const groupName = customDecodeURI(useParams<{ group: string }>().group);
  const [names, setNames] = useState<string[]>([]);
  const { items, loading, stale } = useItemsInGroup(names);
  const [missing, setMissing] = useState<boolean | null>(null);
  const [storageError, setStorageError] = useState("");

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(groupName);
  const [renameError, setRenameError] = useState("");

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [searchItem, setSearchItem] = useState("");
  const [addItemPreviews, setAddItemPreviews] = useState<ItemPreview[]>([]);

  function handleRemove(itemName: string) {
    let nextNames = names;
    const updatedGroups = listGroups().map((g) => {
      if (g.name === groupName) {
        const updatedItems = g.items.filter((name) => name !== itemName);
        nextNames = updatedItems;

        return {
          name: g.name,
          items: updatedItems,
        };
      }
      return g;
    });

    try {
      saveGroups(updatedGroups);
      setNames(nextNames);
      setStorageError("");
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not save this group.");
    }
  }

  function handleDelete() {
    const updatedGroups = listGroups().filter(
      (g) => g.name !== groupName
    );

    try {
      saveGroups(updatedGroups);
      router.push("/item-groups");
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not delete this group.");
    }
  }

  function handleRename() {
    setRenameError("");
    const newName = renameValue.trim();

    if (!newName) {
      setRenameError("Name cannot be empty");
      return;
    }
    if (newName.length > MAX_GROUP_NAME_LENGTH) {
      setRenameError(`Name must be ${MAX_GROUP_NAME_LENGTH} characters or fewer`);
      return;
    }

    const groups = listGroups();

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

    try {
      saveGroups(updated);
      setRenameOpen(false);
      router.push(`/item-groups/${customEncodeURI(newName)}`);
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : "Could not rename this group.");
    }
  }

  function handleAddItem(itemName: string, _gridImageLink: string) {
    const groups = listGroups();

    const updated = groups.map((g) => {
      if (g.name === groupName) {
        if (g.items.includes(itemName)) return g;
        if (g.items.length >= MAX_GROUP_ITEMS) return g;
        return { name: g.name, items: [...g.items, itemName] };
      }
      return g;
    });

    const group = groups.find((candidate) => candidate.name === groupName);
    if (group && group.items.length >= MAX_GROUP_ITEMS) {
      setStorageError(`A group can contain at most ${MAX_GROUP_ITEMS} items.`);
      return;
    }
    try {
      saveGroups(updated);
      setStorageError("");
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not add this item.");
      return;
    }
    setNames((prev) => (prev.includes(itemName) ? prev : [...prev, itemName]));
    setSearchItem("");
    setAddItemOpen(false);
  }

  useEffect(() => {
    const group = listGroups().find(
      (group) => group.name.toLowerCase() === groupName.toLowerCase()
    );

    if (!group) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setNames(group.items);
  }, [groupName]);

  if (missing === true) {
    return <LocalMissing title="Item group not found" backHref="/item-groups" backLabel="Back to groups" />;
  }

  if (missing === null || loading)
    return (
      <div className="max-w-4xl w-full min-w-0 flex flex-col gap-4">
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
    <div className="max-w-4xl w-full min-w-0 flex flex-col gap-4">
      {(storageError || stale) && (
        <p role="status" className="border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-200">
          {storageError || "Showing saved data while fresh prices are loaded."}
        </p>
      )}
      <div className="w-full flex flex-wrap gap-4 text-xl justify-between items-center">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-3xl text-[#9a8866] uppercase tracking-widest font-black truncate">{groupName}</h1>
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
                maxLength={MAX_GROUP_NAME_LENGTH}
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
