import Image from "next/image";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, LoaderCircle, Search, X } from "lucide-react";
import { useGameMode } from "@/components/game-mode/context";
import { prefetchItem, useCatalog } from "@/app/lib/cache/hooks";
import { filterCatalog } from "@/app/lib/search/filter-catalog";
import type { CatalogItem } from "@/app/lib/cache/types";
import { cn } from "@/lib/utils";

const EMPTY_NAMES: string[] = [];

export function ItemSearch({
  onSelect,
  excludeNames = EMPTY_NAMES,
  label = "Search items",
  placeholder = "Search by name or short name",
  autoFocus = false,
  shortcut = false,
  prefetch = false,
  keepOpenOnSelect = false,
}: {
  onSelect: (item: CatalogItem) => void;
  excludeNames?: string[];
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  shortcut?: boolean;
  prefetch?: boolean;
  keepOpenOnSelect?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const prefetchTimer = useRef<number | undefined>(undefined);
  const { gameMode } = useGameMode();
  const { catalog, loading, error, stale, refresh } = useCatalog();

  const results = search.trim() ? filterCatalog(catalog, search, excludeNames) : [];
  const showList = open && search.trim().length > 0;
  const active = results[Math.min(activeIndex, results.length - 1)];

  useEffect(() => {
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => () => window.clearTimeout(prefetchTimer.current), []);

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);

  const highlight = (index: number) => {
    setActiveIndex(index);
    window.clearTimeout(prefetchTimer.current);
    const target = results[index];
    if (prefetch && target) {
      prefetchTimer.current = window.setTimeout(() => prefetchItem(target.name, gameMode), 150);
    }
  };

  const choose = (item: CatalogItem) => {
    onSelect(item);
    setSearch("");
    setActiveIndex(0);
    if (keepOpenOnSelect) {
      inputRef.current?.focus();
    } else {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (search) {
        event.preventDefault();
        setSearch("");
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      highlight((activeIndex + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(activeIndex <= 0 ? results.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      choose(active);
    }
  };

  return (
    <div className="relative flex min-w-0 flex-col gap-2">
      <label htmlFor={`${listboxId}-input`} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#777]" />
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={search}
          onChange={(event) => {
            const value = event.target.value;
            setSearch(value);
            setOpen(true);
            setActiveIndex(0);
            window.clearTimeout(prefetchTimer.current);
            const top = prefetch && value.trim() ? filterCatalog(catalog, value, excludeNames, 1)[0] : undefined;
            if (top) prefetchTimer.current = window.setTimeout(() => prefetchItem(top.name, gameMode), 300);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList && results.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={showList && active ? `${listboxId}-${results.indexOf(active)}` : undefined}
          className="h-12 w-full border border-[#2a2a2a] bg-[#0c0c0c] pl-10 pr-20 text-base text-[#ddd] placeholder:text-[#666] transition-colors focus:border-[#9a8866] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading && search && <LoaderCircle aria-label="Loading items" className="h-4 w-4 animate-spin text-[#9a8866]" />}
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSearch("");
                inputRef.current?.focus();
              }}
              className="flex h-9 w-9 items-center justify-center text-[#888] hover:text-[#ddd]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            shortcut && (
              <kbd className="hidden border border-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#777] sm:inline">/</kbd>
            )
          )}
        </div>
      </div>

      {showList && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 border border-[#2a2a2a] bg-[#0a0a0a] shadow-2xl shadow-black">
          {results.length > 0 ? (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Item search results"
              className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain py-1"
            >
              {results.map((item, index) => (
                <li
                  key={item.name}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={item === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item)}
                  onMouseEnter={() => highlight(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                    item === active ? "bg-[#1a1712] text-[#e6d9b8]" : "text-[#bbb]"
                  )}
                >
                  {item.gridImageLink ? (
                    <Image
                      src={item.gridImageLink}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 object-contain"
                    />
                  ) : (
                    <span className="h-8 w-8 shrink-0 bg-[#151515]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.shortName && item.shortName !== item.name && (
                    <span className="shrink-0 border border-[#2a2a2a] px-1.5 text-[10px] uppercase tracking-wider text-[#888]">
                      {item.shortName}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : loading ? (
            <p className="flex items-center gap-2 p-3 text-sm text-[#999]">
              <LoaderCircle className="h-4 w-4 animate-spin text-[#9a8866]" />
              Loading the item catalog…
            </p>
          ) : error && catalog.length === 0 ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void refresh()}
              className="flex w-full items-center gap-2 p-3 text-left text-sm text-[#c9b88d]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Item catalog unavailable. Tap to retry.
            </button>
          ) : (
            <p className="p-3 text-sm text-[#999]">No items match &ldquo;{search.trim()}&rdquo;</p>
          )}
        </div>
      )}

      {stale && catalog.length > 0 && !showList && (
        <p role="status" className="sr-only">
          Showing saved item data while the catalog refreshes.
        </p>
      )}
    </div>
  );
}
