"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { LoaderCircle, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useBulkCache } from "@/app/lib/cache/provider";

const EMPTY_NAMES: string[] = [];

export default function SearchWrapper({
  handleSelect,
  params = null,
  excludeNames = EMPTY_NAMES,
}: {
  handleSelect: (itemName: string) => void;
  params?: { itemName: string } | null;
  excludeNames?: string[];
}) {
  const [search, setSearch] = useState("");
  const { catalog: items, loading: isLoading, error, refreshCatalog } = useBulkCache();

  useEffect(() => {
    if (params?.itemName) {
      setSearch("");
    }
  }, [params?.itemName]);

  const filtered = useMemo(() => {
    if (!search) return null;
    const needle = search.toLocaleLowerCase();
    const excluded = new Set(excludeNames);
    const matches = [];
    for (const item of items) {
      if (!excluded.has(item.name) && item.name.toLocaleLowerCase().includes(needle)) {
        matches.push(item);
        if (matches.length === 20) break;
      }
    }
    return matches;
  }, [search, items, excludeNames]);

  const placeholder = useMemo(() => {
    if (isLoading) return "Loading items...";
    if (params?.itemName) return "Enter item name";
    const example = items[Math.floor(items.length / 2)];
    return example ? `e.g., ${example.name}` : "Enter item name";
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
      {error && items.length === 0 && (
        <button
          type="button"
          onClick={() => void refreshCatalog()}
          className="flex items-center gap-2 border border-[#9a8866] bg-[#2a1800] p-3 text-left text-sm text-[#c9b88d]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Item catalog unavailable. Select to retry.
        </button>
      )}
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
