"use client";

import Image from "next/image";
import type { PriceHighlight, PriceHighlights } from "@/app/lib/api/tarkov-server";
import type { GameMode } from "@/components/game-mode/mode";
import { MODE_LABEL, useServerModeSync } from "@/components/game-mode/use-server-mode-sync";
import { Rubles } from "@/app/lib/currency";
import { cn } from "@/lib/utils";
import { ItemRundownLink } from "@/app/components/item/rundown/rundown-link";

function HighlightTable({
  id,
  title,
  description,
  rows,
  primary,
}: {
  id: string;
  title: string;
  description: string;
  rows: PriceHighlight[];
  primary: "perSlot" | "price";
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div>
        <h2 id={id} className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
          {title}
        </h2>
        <p className="mt-1 text-xs text-[#888]">{description}</p>
      </div>
      <table className="w-full table-fixed border border-[#1a1a1a] bg-[#0c0c0c] text-sm">
        {/* table-fixed takes widths from the first row, which is the visually hidden header. */}
        <colgroup>
          <col />
          <col className="w-28 sm:w-32" />
          <col className="w-0 sm:w-40" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Item</th>
            <th scope="col">{primary === "perSlot" ? "Price per slot" : "Best sell price"}</th>
            <th scope="col">{primary === "perSlot" ? "Best sell price" : "Where to sell"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#151515]">
          {rows.map((row, index) => (
            <tr key={row.normalizedName} className="hover:bg-[#100f0c]">
              <td className="py-1.5 pl-2 pr-1">
                <ItemRundownLink item={row} className="flex min-w-0 items-center gap-2 text-[#ccc] hover:text-[#e6d9b8]">
                  <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-[#555]">{index + 1}</span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#111]">
                    {row.gridImageLink && (
                      <Image src={row.gridImageLink} alt="" width={32} height={32} className="max-h-8 w-auto object-contain" />
                    )}
                  </span>
                  <span className="truncate">{row.name}</span>
                </ItemRundownLink>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-[#e6d9b8] sm:w-32">
                {Rubles.format(primary === "perSlot" ? row.perSlot : row.price)}
              </td>
              <td className="hidden py-1.5 pr-3 text-right text-xs text-[#888] sm:table-cell">
                {primary === "perSlot"
                  ? `${Rubles.format(row.price)} · ${row.slots} slot${row.slots === 1 ? "" : "s"}`
                  : row.flea
                    ? "Flea, after fee"
                    : row.vendor}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Server-rendered price tables for the cookie's game mode, refreshed when the visitor switches mode. */
export function PriceHighlightTables({ gameMode, highlights }: { gameMode: GameMode; highlights: PriceHighlights }) {
  const { switching, current } = useServerModeSync(gameMode);
  return (
    <Tables
      highlights={highlights}
      busy={switching}
      note={switching ? `Loading ${MODE_LABEL[current]} prices…` : `Showing ${MODE_LABEL[gameMode]} prices. Switch mode in the header.`}
    />
  );
}

/** Price tables for one game mode, whatever mode the visitor has selected. */
export function FixedModePriceTables({ gameMode, highlights }: { gameMode: GameMode; highlights: PriceHighlights }) {
  return <Tables highlights={highlights} busy={false} note={`Showing ${MODE_LABEL[gameMode]} prices.`} />;
}

function Tables({ highlights, busy, note }: { highlights: PriceHighlights; busy: boolean; note: string }) {
  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", busy && "opacity-50")} aria-busy={busy}>
      <p className="text-xs text-[#888]">{note}</p>
      <HighlightTable
        id="best-per-slot"
        title="Most valuable loot per slot"
        description="What to fill your backpack with: the best sell price divided by the slots the item takes."
        rows={highlights.byPerSlot}
        primary="perSlot"
      />
      <HighlightTable
        id="most-expensive"
        title="Most expensive items"
        description="The highest-priced items on the flea market and at traders right now."
        rows={highlights.byPrice}
        primary="price"
      />
      <HighlightTable
        id="most-valuable-keys"
        title="Most valuable keys and keycards"
        description="Keys ranked by what they sell for. Open a key to see the price and what it's needed for."
        rows={highlights.keys}
        primary="price"
      />
    </div>
  );
}
