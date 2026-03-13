"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { LoaderCircle, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function SearchWrapper({
  handleSelect,
  params = null,
  excludeNames = [],
}: {
  handleSelect: (itemName: string) => void;
  params?: { itemName: string } | null;
  excludeNames?: string[];
}) {
  const [items, setItems] = useState<{ name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function getItems() {
      const stored = localStorage.getItem("items");
      if (stored) {
        setItems(JSON.parse(stored));
        setIsLoading(false);
        return;
      }
      setTimeout(getItems, 200);
    }
    getItems();
  }, []);

  useEffect(() => {
    if (params?.itemName) {
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const filtered = useMemo(() => {
    if (!search) return null;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    const excluded = new Set(excludeNames);
    return items
      .filter((item) => regex.test(item.name) && !excluded.has(item.name))
      .slice(0, 20);
  }, [search, items, excludeNames]);

  const placeholder = useMemo(() => {
    if (isLoading) return "Loading items...";
    if (params?.itemName) return "Enter item name";
    const random = items[Math.floor(Math.random() * items.length)];
    return random ? `e.g., ${random.name}` : "Enter item name";
  }, [isLoading, items, params]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
  }

  function onSelect(name: string) {
    handleSelect(name);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <h2 className="uppercase tracking-widest text-xs font-bold text-muted-foreground">Search item</h2>
      <div className="relative">
        <Input
          name="search"
          disabled={isLoading}
          placeholder={placeholder}
          value={search}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          onChange={handleChange}
        />
        {isLoading && (
          <LoaderCircle className="absolute right-2 top-2 animate-spin" size={20} />
        )}
      </div>
      {filtered && (
        filtered.length > 0 ? (
          <div className="max-h-[200px] overflow-auto border">
            {filtered.map((item) => (
              <button
                key={item.name}
                type="button"
                className="block w-full text-left px-3 py-2 text-sm truncate hover:bg-accent transition-colors"
                onClick={() => onSelect(item.name)}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-[#2a1800] border-[#9a8866] border p-3 flex flex-row gap-2">
            <AlertTriangle className="text-[#9a8866] shrink-0" />
            <p className="text-[#9a8866]">
              No item contains the search phrase &quot;{search}&quot;
            </p>
          </div>
        )
      )}
    </div>
  );
}
