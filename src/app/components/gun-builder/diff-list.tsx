import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Equal, Minus, Plus, Repeat2 } from "lucide-react";
import type { DiffStatus, SlotDiffRow } from "@/app/lib/builds/compare";
import type { ItemLookup } from "@/app/lib/builds/stats";
import { itemHref } from "@/app/lib/item-links";
import { cn } from "@/lib/utils";

const STATUS: Record<DiffStatus, { label: string; icon: typeof Plus; className: string }> = {
  added: { label: "Added", icon: Plus, className: "border-emerald-800/70 text-emerald-300" },
  removed: { label: "Removed", icon: Minus, className: "border-red-900/70 text-red-300" },
  changed: { label: "Changed", icon: Repeat2, className: "border-[#7a6a48] text-[#e6d9b8]" },
  same: { label: "Same", icon: Equal, className: "border-[#2a2a2a] text-[#666]" },
};

function ItemCell({
  itemId,
  lookup,
  link,
  muted,
  side,
}: {
  itemId: string | null;
  lookup: ItemLookup;
  link: boolean;
  muted: boolean;
  side: string;
}) {
  if (!itemId) {
    return <span className="text-xs uppercase tracking-widest text-[#555]">Empty</span>;
  }
  const item = lookup.get(itemId);
  const label = item?.shortName ?? "Unknown item";
  const content = (
    <>
      <span className="flex h-7 w-9 shrink-0 items-center justify-center bg-[#050505]">
        {item?.gridImageLink && (
          <Image src={item.gridImageLink} alt="" width={36} height={28} className="h-full w-full object-contain p-0.5" />
        )}
      </span>
      <span className={cn("min-w-0 truncate text-sm", muted ? "text-[#777]" : "text-[#ddd]")}>{label}</span>
    </>
  );
  if (link && item) {
    return (
      <Link
        href={itemHref(item)}
        prefetch={false}
        title={`${side}: ${item.name}. View item`}
        className="flex min-w-0 items-center gap-2 hover:[&>span:last-child]:text-[#e6d9b8] hover:[&>span:last-child]:underline focus-visible:outline-2 focus-visible:outline-[#9a8866]"
      >
        {content}
      </Link>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2" title={item?.name}>
      {content}
    </span>
  );
}

export function DiffList({
  rows,
  lookup,
  leftLabel,
  rightLabel,
  links = false,
}: {
  rows: SlotDiffRow[];
  lookup: ItemLookup;
  leftLabel: string;
  rightLabel: string;
  links?: boolean;
}) {
  return (
    <ul className="border border-[#1a1a1a] bg-[#0c0c0c]">
      <li
        aria-hidden
        className="hidden grid-cols-[minmax(0,13rem)_minmax(0,1fr)_1.5rem_minmax(0,1fr)] gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#888] sm:grid"
      >
        <span>Slot</span>
        <span className="truncate">{leftLabel}</span>
        <span />
        <span className="truncate">{rightLabel}</span>
      </li>
      {rows.map((row) => {
        const status = STATUS[row.status];
        const Icon = status.icon;
        const same = row.status === "same";
        return (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 border-t border-[#161616] px-3 py-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_1.5rem_minmax(0,1fr)] sm:gap-x-3"
          >
            <span className="col-span-3 flex min-w-0 items-center gap-2 sm:col-span-1">
              <span
                className={cn("flex h-5 w-5 shrink-0 items-center justify-center border", status.className)}
                title={status.label}
              >
                <Icon className="h-3 w-3" aria-hidden />
                <span className="sr-only">{status.label}</span>
              </span>
              <span className="min-w-0" style={{ paddingLeft: Math.min(row.depth, 5) * 8 }}>
                {row.context.length > 0 && (
                  <span className="block truncate text-[9px] font-bold uppercase tracking-widest text-[#555]">
                    {row.context.join(" / ")}
                  </span>
                )}
                <span className={cn("block truncate text-[11px] font-bold uppercase tracking-widest", same ? "text-[#666]" : "text-[#aaa]")}>
                  {row.label}
                </span>
              </span>
            </span>
            <ItemCell itemId={row.left} lookup={lookup} link={links} muted={same || row.status === "changed"} side={leftLabel} />
            <ArrowRight className={cn("h-3.5 w-3.5 justify-self-center", same ? "text-[#333]" : "text-[#9a8866]")} aria-hidden />
            <ItemCell itemId={row.right} lookup={lookup} link={links} muted={same} side={rightLabel} />
          </li>
        );
      })}
    </ul>
  );
}
