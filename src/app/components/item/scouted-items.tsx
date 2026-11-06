"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import { useHydrated } from "@/app/lib/storage/use-store";
import {
  clearScoutedItems,
  setScoutedCollapsed,
  useScoutedCollapsed,
  useScoutedItems,
  type ScoutedItem,
} from "@/app/lib/scouted-items/store";

function ScoutedLink({ item, compact = false }: { item: ScoutedItem; compact?: boolean }) {
  return (
    <Link
      href={`/item/${customEncodeURI(item.name)}`}
      className={
        compact
          ? "flex min-w-0 items-center gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-2 transition-colors hover:border-[#9a8866]"
          : "group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[#111]"
      }
    >
      {item.gridImageLink ? (
        <Image src={item.gridImageLink} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
      ) : (
        <span className="h-7 w-7 shrink-0 bg-[#151515]" />
      )}
      <span className="truncate text-xs text-[#aaa] transition-colors group-hover:text-[#ddd]">{item.name}</span>
    </Link>
  );
}

export function RecentItems() {
  const items = useScoutedItems();
  const hydrated = useHydrated();
  if (!hydrated || items.length === 0) return null;
  return (
    <section aria-labelledby="recent-items" className="flex flex-col gap-2 lg:hidden">
      <h2 id="recent-items" className="text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
        Recently viewed
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.slice(0, 8).map((item) => (
          <ScoutedLink key={item.name} item={item} compact />
        ))}
      </div>
    </section>
  );
}

export default function ScoutedSidebar() {
  const items = useScoutedItems();
  const collapsed = useScoutedCollapsed();
  const hydrated = useHydrated();
  const [storageError, setStorageError] = useState("");

  const toggleCollapsed = () => {
    try {
      setScoutedCollapsed(!collapsed);
      setStorageError("");
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not save sidebar settings.");
    }
  };

  if (!hydrated) return <div className="w-56 shrink-0 self-stretch border-r border-[#1a1a1a] bg-[#070707]" />;

  if (collapsed) {
    return (
      <aside aria-label="Recently viewed items" className="shrink-0 self-stretch border-r border-[#1a1a1a] bg-[#070707]">
        <div className="sticky top-0 p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-9 w-9 items-center justify-center text-[#777] transition-colors hover:text-[#ccc]"
            aria-label="Expand recently viewed items"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label="Recently viewed items" className="w-56 shrink-0 self-stretch border-r border-[#1a1a1a] bg-[#070707]">
      <div className="sticky top-0 flex flex-col">
        <div className="flex items-center justify-between border-b border-[#1a1a1a] px-3 py-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#9a8866]">Recently viewed</h2>
          <div className="flex items-center">
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => clearScoutedItems()}
                className="px-2 py-2 text-[10px] uppercase tracking-widest text-[#777] hover:text-[#ccc]"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-9 w-9 items-center justify-center text-[#777] transition-colors hover:text-[#ccc]"
              aria-label="Collapse recently viewed items"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>
        {storageError && <p role="alert" className="px-3 pt-2 text-[10px] text-red-300">{storageError}</p>}
        <div className="flex max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-[#888]">Items you open will appear here.</p>
          ) : (
            items.map((item) => <ScoutedLink key={item.name} item={item} />)
          )}
        </div>
      </div>
    </aside>
  );
}
