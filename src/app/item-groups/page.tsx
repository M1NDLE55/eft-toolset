"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NameDialog } from "@/components/name-dialog";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import { createGroup, useGroups } from "@/app/lib/item-groups/store";
import { MAX_GROUP_NAME_LENGTH } from "@/app/lib/item-groups/limits";
import { useCatalog } from "@/app/lib/cache/hooks";
import { useHydrated } from "@/app/lib/storage/use-store";

export default function Page() {
  const router = useRouter();
  const groups = useGroups();
  const hydrated = useHydrated();
  const { itemsByName } = useCatalog();

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Item groups</h1>
          <p className="mt-1 text-sm text-[#888]">Watchlists with live prices, saved in this browser.</p>
        </div>
        <NameDialog
          trigger={
            <Button>
              <Plus /> New group
            </Button>
          }
          title="New group"
          description="Name your new item group."
          submitLabel="Create"
          maxLength={MAX_GROUP_NAME_LENGTH}
          onSubmit={(name) => router.push(`/item-groups/${customEncodeURI(createGroup(name))}`)}
        />
      </div>

      {!hydrated ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[68px] w-full" />
          ))}
        </div>
      ) : groups.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <li key={group.name}>
              <Link
                href={`/item-groups/${customEncodeURI(group.name)}`}
                className="group flex items-center gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-3 transition-colors hover:border-[#9a8866]"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-semibold text-[#ddd] group-hover:text-[#e6d9b8]">{group.name}</span>
                  <span className="text-xs text-[#888]">
                    {group.items.length} item{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden>
                  {group.items.slice(0, 5).map((name) => {
                    const image = itemsByName.get(name)?.gridImageLink;
                    return image ? (
                      <Image key={name} src={image} alt="" width={32} height={32} className="h-8 w-8 bg-[#111] object-contain" />
                    ) : (
                      <span key={name} className="h-8 w-8 bg-[#111]" />
                    );
                  })}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#9a8866]" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 border border-dashed border-[#2a2a2a] p-8 text-center">
          <p className="font-semibold text-[#ccc]">No item groups yet</p>
          <p className="text-sm text-[#888]">Create one to track prices for the loot you care about.</p>
        </div>
      )}
    </div>
  );
}
