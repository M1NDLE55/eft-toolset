"use client";

import { ChangeEvent, useEffect, useId, useMemo, useState } from "react";
import { LoaderCircle, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useBulkCache } from "@/app/lib/cache/provider";
import { filterCatalog } from "@/app/lib/search/filter-catalog";

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const { catalog: items, loading: isLoading, error, stale, refreshCatalog } = useBulkCache();

  useEffect(() => {
    if (params?.itemName) {
      setSearch("");
    }
  }, [params?.itemName]);

  const filtered = useMemo(() => {
    if (!search) return null;
    return filterCatalog(items, search, excludeNames);
  }, [search, items, excludeNames]);

  const placeholder = useMemo(() => {
    if (isLoading) return "Loading items...";
    if (params?.itemName) return "Enter item name";
    const example = items[Math.floor(items.length / 2)];
    return example ? `e.g., ${example.name}` : "Enter item name";
  }, [isLoading, items, params]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setActiveIndex(-1);
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
          role="combobox"
          aria-label="Search items"
          aria-autocomplete="list"
          aria-expanded={Boolean(filtered?.length)}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 && activeIndex < (filtered?.length ?? 0)
              ? `${listboxId}-${activeIndex}`
              : undefined
          }
          onKeyDown={(event) => {
            if (!filtered?.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % filtered.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) =>
                current <= 0 ? filtered.length - 1 : current - 1
              );
            } else if (event.key === "Enter" && filtered[activeIndex]) {
              event.preventDefault();
              onSelect(filtered[activeIndex].name);
            } else if (event.key === "Escape") {
              setSearch("");
              setActiveIndex(-1);
            }
          }}
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
      {stale && items.length > 0 && (
        <p role="status" className="text-xs text-amber-300">
          Showing saved item data while the catalog refreshes.
        </p>
      )}
      {filtered && (
        filtered.length > 0 ? (
          <div id={listboxId} role="listbox" aria-label="Item search results" className="max-h-[200px] overflow-auto border">
            {filtered.map((item, index) => (
              <button
                key={item.name}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className="block w-full text-left px-3 py-2 text-sm truncate hover:bg-accent transition-colors"
                onClick={() => onSelect(item.name)}
                onMouseEnter={() => setActiveIndex(index)}
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
