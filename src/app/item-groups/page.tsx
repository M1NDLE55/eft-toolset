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
import { listGroups, saveGroups, subscribeGroups } from "@/app/lib/item-groups/store";
import { MAX_GROUP_NAME_LENGTH, MAX_GROUPS } from "@/app/lib/item-groups/limits";

export default function Page() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    setLoading(true);
    setGroups(listGroups());
    setLoading(false);
    return subscribeGroups(() => setGroups(listGroups()));
  }, []);

  function handleCreate() {
    setCreateError("");
    const name = createName.trim();

    if (!name) {
      setCreateError("Name cannot be empty");
      return;
    }
    if (name.length > MAX_GROUP_NAME_LENGTH) {
      setCreateError(`Name must be ${MAX_GROUP_NAME_LENGTH} characters or fewer`);
      return;
    }

    const groups = listGroups();

    if (groups.length >= MAX_GROUPS) {
      setCreateError(`You can save at most ${MAX_GROUPS} groups.`);
      return;
    }

    if (groups.find((g) => g.name.toLowerCase() === name.toLowerCase())) {
      setCreateError("A group with this name already exists");
      return;
    }

    try {
      saveGroups([...groups, { name, items: [] }]);
      setCreateOpen(false);
      setCreateName("");
      router.push(`/item-groups/${customEncodeURI(name)}`);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "Could not create this group.");
    }
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
                maxLength={MAX_GROUP_NAME_LENGTH}
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
