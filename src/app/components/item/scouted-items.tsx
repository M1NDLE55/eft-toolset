"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const STORAGE_KEY = "eft-toolset:scouted-items";
const COLLAPSED_KEY = "eft-toolset:scouted-collapsed";
const MAX_SCOUTED = 20;

export interface ScoutedItem {
  name: string;
  gridImageLink: string | null;
}

export function addScoutedItem(item: ScoutedItem) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const items: ScoutedItem[] = raw ? JSON.parse(raw) : [];
    const filtered = items.filter((i) => i.name !== item.name);
    filtered.unshift(item);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(filtered.slice(0, MAX_SCOUTED))
    );
    window.dispatchEvent(new Event("scouted-update"));
  } catch {
    // ignore storage errors
  }
}

function getScoutedItems(): ScoutedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function ScoutedSidebar() {
  const [items, setItems] = useState<ScoutedItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setItems(getScoutedItems());
    setCollapsed(getCollapsed());
    setMounted(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setItems(getScoutedItems());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onUpdate = () => setItems(getScoutedItems());
    window.addEventListener("scouted-update", onUpdate);
    return () => window.removeEventListener("scouted-update", onUpdate);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // ignore
    }
  };

  if (!mounted) return <div className="w-56 shrink-0 self-stretch" />;

  if (collapsed) {
    return (
      <aside className="shrink-0 self-stretch border-r border-[#1a1a1a] bg-[#070707]">
        <div className="sticky top-0 p-2">
          <button
            onClick={toggleCollapsed}
            className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-56 shrink-0 self-stretch border-r border-[#1a1a1a] bg-[#070707]">
      <div className="sticky top-0 flex flex-col">
        <div className="flex items-center justify-between px-3 py-3 border-b border-[#1a1a1a]">
          <h2 className="text-[10px] uppercase tracking-widest text-[#9a8866] font-semibold">
            Scouted
          </h2>
          <button
            onClick={toggleCollapsed}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col py-1 overflow-y-auto max-h-[calc(100vh-8rem)]">
          {items.length === 0 ? (
            <p className="text-[11px] text-zinc-600 px-3 py-4">
              Viewed items will appear here
            </p>
          ) : (
            items.map((item) => (
              <Link
                key={item.name}
                href={`/item/${customEncodeURI(item.name)}`}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#111] transition-colors group"
              >
                {item.gridImageLink ? (
                  <Image
                    src={item.gridImageLink}
                    alt={item.name}
                    width={28}
                    height={28}
                    className="object-contain shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 bg-zinc-800 shrink-0" />
                )}
                <span className="text-xs text-zinc-400 group-hover:text-zinc-200 truncate transition-colors">
                  {item.name}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
