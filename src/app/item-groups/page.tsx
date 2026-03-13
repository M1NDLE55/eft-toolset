"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GroupSelector from "../components/item-groups/group-selector";
import { Group } from "../lib/types/itemGroups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { customEncodeURI } from "../lib/URIEncoding";

export default function Page() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    setLoading(true);
    if (!localStorage.getItem("item-groups")) {
      localStorage.setItem("item-groups", "[]");
    }

    setGroups(JSON.parse(localStorage.getItem("item-groups") as string));
    setLoading(false);
  }, []);

  function handleCreate() {
    setCreateError("");
    const name = createName.trim();

    if (!name) {
      setCreateError("Name cannot be empty");
      return;
    }

    const groups: Group[] =
      JSON.parse(localStorage.getItem("item-groups") as string) || [];

    if (groups.find((g) => g.name.toLowerCase() === name.toLowerCase())) {
      setCreateError("A group with this name already exists");
      return;
    }

    localStorage.setItem(
      "item-groups",
      JSON.stringify([...groups, { name, items: [] }])
    );

    setCreateOpen(false);
    setCreateName("");
    router.push(`/item-groups/${customEncodeURI(name)}`);
  }

  return (
    <div className="max-w-xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl justify-between items-center">
        <h1 className="text-3xl">Item Groups</h1>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) { setCreateName(""); setCreateError(""); } }}>
          <DialogTrigger asChild>
            <Button variant={"outline"}>Create</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create group</DialogTitle>
              <DialogDescription>Enter a name for the new group.</DialogDescription>
            </DialogHeader>
            {createError && <p className="text-red-500 text-sm">{createError}</p>}
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
              placeholder="Group name"
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[52px] w-full" />
          <Skeleton className="h-[52px] w-full" />
          <Skeleton className="h-[52px] w-full" />
        </div>
      ) : groups.length > 0 ? (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <GroupSelector key={group.name} group={group} />
          ))}
        </div>
      ) : (
        <p className="p-3 w-full border border-[#2a2a2a] text-xl">
          No item groups
        </p>
      )}
    </div>
  );
}
