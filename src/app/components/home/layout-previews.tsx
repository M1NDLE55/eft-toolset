import type { ReactNode } from "react";
import type { HomeLayout } from "@/app/lib/settings/store";
import { cn } from "@/lib/utils";

/** Small schematic drawings of each home screen layout, for the settings page. */

const tile = "border border-[#222] bg-[#0e0e0e]";

function Label({ children }: { children: ReactNode }) {
  return <span className="text-5xs font-bold uppercase leading-none tracking-widest text-[#9a8866]">{children}</span>;
}

function Line({ className }: { className?: string }) {
  return <span className={cn("block h-1 bg-[#262626]", className)} />;
}

function SearchBar({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-3.5 items-center gap-1 border border-[#333] bg-[#0e0e0e] px-1", className)}>
      <span className="h-1.5 w-1.5 rounded-full border border-[#666]" />
      <Line className="w-1/3" />
    </span>
  );
}

function Rows({ count, tone }: { count: number; tone?: "up" | "down" }) {
  return (
    <span className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="flex items-center gap-1">
          <span className="h-2 w-2 shrink-0 bg-[#262626]" />
          <Line className="flex-1" />
          <span className={cn("h-1 w-3 shrink-0", tone === "up" ? "bg-emerald-500/70" : tone === "down" ? "bg-red-400/70" : "bg-[#3a3a3a]")} />
        </span>
      ))}
    </span>
  );
}

function Tile({ label, className, children }: { label: string; className?: string; children?: ReactNode }) {
  return (
    <span className={cn(tile, "flex min-w-0 flex-col gap-1 p-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </span>
  );
}

function ToolRow() {
  return (
    <span className="grid grid-cols-4 gap-1">
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={cn(tile, "flex h-3.5 items-center gap-1 px-1")}>
          <span className="h-1.5 w-1.5 border border-[#9a8866]" />
          <Line className="flex-1" />
        </span>
      ))}
    </span>
  );
}

function Route() {
  return (
    <svg viewBox="0 0 100 50" className="w-full flex-1 border border-[#1c1c1c] bg-[#0a0b0a]">
      <polyline points="10,40 28,30 44,33 60,18 88,10" fill="none" stroke="#c8b384" strokeWidth="1.5" strokeDasharray="4 2.5" />
      <circle cx="10" cy="40" r="2.5" fill="#c8b384" />
      <rect x="85.5" y="7.5" width="5" height="5" fill="#34d399" />
    </svg>
  );
}

function Bento() {
  return (
    <>
      <SearchBar />
      <span className="grid flex-1 grid-cols-[1.25fr_1fr] grid-rows-[1fr_1fr_auto] gap-1">
        <Tile label="Items">
          <Rows count={3} />
        </Tile>
        <Tile label="Plan" className="row-span-2">
          <Route />
          <Line className="w-2/3" />
        </Tile>
        <Tile label="Build">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-7 shrink-0 bg-[#262626]" />
            <span className="flex flex-1 flex-col gap-1">
              <Line className="w-full bg-[#9a8866]/70" />
              <Line className="w-2/3 bg-[#9a8866]/70" />
            </span>
          </span>
        </Tile>
        <Tile label="Groups" className="col-span-2">
          <span className="grid grid-cols-3 gap-1">
            {[0, 1, 2].map((index) => (
              <span key={index} className="flex flex-col gap-1 border border-[#1c1c1c] p-1">
                <Line className="w-1/2" />
                <Line className="h-1.5 w-3/4 bg-[#3a3a3a]" />
              </span>
            ))}
          </span>
        </Tile>
      </span>
    </>
  );
}

function SearchFirst() {
  return (
    <span className="flex flex-1 flex-col items-center justify-center gap-2">
      <span className="h-4 w-24 bg-[#d8d8d8]" />
      <Line className="w-32" />
      <SearchBar className="h-5 w-4/5 border-[#9a8866]" />
      <span className="flex gap-1">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={cn(tile, "h-2.5 w-8")} />
        ))}
      </span>
      <span className="grid w-full grid-cols-2 gap-1">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={cn(tile, "flex h-5 items-center gap-1 px-1")}>
            <span className="h-2.5 w-2.5 border border-[#9a8866]" />
            <Line className="flex-1" />
          </span>
        ))}
      </span>
    </span>
  );
}

function Market() {
  return (
    <>
      <SearchBar />
      <span className="grid flex-1 grid-cols-3 gap-1">
        <Tile label="Risers">
          <Rows count={5} tone="up" />
        </Tile>
        <Tile label="Fallers">
          <Rows count={5} tone="down" />
        </Tile>
        <Tile label="Per slot">
          <Rows count={5} />
        </Tile>
      </span>
      <Tile label="Groups">
        <span className="grid grid-cols-3 gap-1">
          {[0, 1, 2].map((index) => (
            <Line key={index} className="h-1.5 bg-[#3a3a3a]" />
          ))}
        </span>
      </Tile>
      <ToolRow />
    </>
  );
}

function Maps() {
  return (
    <>
      <span className="flex items-end justify-between gap-2">
        <span className="h-2.5 w-24 bg-[#cfc4a6]" />
        <SearchBar className="w-1/3" />
      </span>
      <span className="grid flex-1 grid-cols-[2fr_1fr] gap-1">
        <span className="grid grid-cols-4 grid-rows-3 gap-1">
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} className={cn(tile, "flex flex-col justify-between p-1", index === 0 && "border-[#9a8866]")}>
              <Line className="w-3/4 bg-[#3a3a3a]" />
              <Line className={cn("w-1/2", index === 0 && "bg-[#9a8866]")} />
            </span>
          ))}
        </span>
        <Tile label="Plan">
          <Route />
        </Tile>
      </span>
      <ToolRow />
    </>
  );
}

const PREVIEWS: Record<HomeLayout, () => ReactNode> = { bento: Bento, search: SearchFirst, market: Market, maps: Maps };

export function LayoutPreview({ layout }: { layout: HomeLayout }) {
  const Preview = PREVIEWS[layout];
  return (
    <span aria-hidden className="flex aspect-[16/11] w-full flex-col gap-1 border border-[#1a1a1a] bg-[#070707] p-2">
      <Preview />
    </span>
  );
}
