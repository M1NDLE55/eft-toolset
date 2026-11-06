"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Plus, X } from "lucide-react";
import type { GunItem } from "@/app/lib/types/gunBuilder";
import type { PositionedNode } from "@/app/lib/builds/tree-layout";
import { itemHref } from "@/app/lib/item-links";
import { cn } from "@/lib/utils";
import { formatErgo, formatRecoilModifier } from "./format";

export type MissingStatus = "loading" | "unavailable" | "failed";

const MISSING_LABEL: Record<MissingStatus, string> = {
  loading: "Loading…",
  unavailable: "Unavailable item",
  failed: "Not loaded",
};

interface BuilderNodeProps {
  node: PositionedNode;
  item: GunItem | undefined;
  fallback?: { shortName: string; gridImageLink: string | null };
  status: MissingStatus;
  onOpen: () => void;
  onRemove: () => void;
  onIntent: () => void;
  compact?: boolean;
}

function Thumb({ item, size }: { item: { gridImageLink: string | null } | undefined; size: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border border-[#1a1a1a] bg-[#050505]",
        size === "md" ? "h-12 w-16" : "h-10 w-12"
      )}
    >
      {item?.gridImageLink ? (
        <Image
          src={item.gridImageLink}
          alt=""
          width={64}
          height={48}
          className="h-full w-full object-contain p-0.5"
        />
      ) : null}
    </span>
  );
}

export function BuilderNode({
  node,
  item,
  fallback,
  status,
  onOpen,
  onRemove,
  onIntent,
  compact = false,
}: BuilderNodeProps) {
  const style = compact
    ? undefined
    : { left: node.x, top: node.y, width: node.width, height: node.height };
  const position = compact ? "relative w-full min-h-14" : "absolute";
  const slotLabel = node.slot?.name ?? (node.incompatible ? "Unknown slot" : "Mod");

  if (node.kind === "weapon") {
    return (
      <div
        data-builder-node
        data-nav-id={node.id}
        tabIndex={-1}
        aria-label={`Weapon: ${item?.name ?? fallback?.shortName ?? "loading"}`}
        style={style}
        className={cn(
          position,
          "flex items-center gap-3 border border-[#9a8866] bg-[#0f0d0a] p-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6d9b8]"
        )}
      >
        <Thumb item={item ?? fallback} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-black uppercase tracking-widest text-[#e6d9b8]">
            {item?.shortName ?? fallback?.shortName ?? MISSING_LABEL[status]}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
            Weapon
          </span>
        </span>
        {item && (
          <Link
            href={itemHref(item)}
            prefetch={false}
            aria-label={`View ${item.name}`}
            title="View item"
            className="flex h-8 w-8 shrink-0 items-center justify-center text-[#9a8866] transition-colors hover:bg-[#1a1712] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8]"
          >
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    );
  }

  if (node.kind === "empty") {
    const required = node.slot?.required;
    return (
      <button
        type="button"
        data-builder-node
        data-nav-id={node.id}
        style={style}
        onClick={onOpen}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        className={cn(
          position,
          "group flex items-center gap-3 border border-dashed p-2.5 text-left transition-colors hover:border-[#9a8866] hover:bg-[#0f0d0a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6d9b8]",
          required ? "border-[#7a6a48] bg-[#0c0a07]" : "border-[#2a2a2a] bg-[#080808]"
        )}
      >
        <span className="flex h-10 w-12 shrink-0 items-center justify-center border border-dashed border-[#2a2a2a] text-[#9a8866] group-hover:border-[#9a8866]">
          <Plus className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold uppercase tracking-widest text-[#bbb] group-hover:text-[#e6d9b8]">
            {slotLabel}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-[10px] font-bold uppercase tracking-widest",
              required ? "text-[#c8b384]" : "text-[#666]"
            )}
          >
            {required ? "Required" : "Empty"}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      data-builder-node
      style={style}
      className={cn(
        position,
        "group flex items-stretch border bg-[#0c0c0c] transition-colors",
        node.incompatible
          ? "border-amber-700/70"
          : "border-[#2a2a2a] hover:border-[#4a4234] focus-within:border-[#9a8866]"
      )}
    >
      <button
        type="button"
        data-nav-id={node.id}
        onClick={onOpen}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        disabled={!node.slot}
        aria-label={`${slotLabel}: ${item?.name ?? "unknown item"}. Change part`}
        className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8] disabled:cursor-default"
      >
        {item || status !== "loading" ? <Thumb item={item} size="sm" /> : <span className="h-10 w-12 shrink-0 animate-shimmer" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-bold uppercase tracking-widest text-[#888]">
            {slotLabel}
          </span>
          <span className="mt-0.5 block truncate text-sm font-bold text-[#ddd] group-hover:text-[#e6d9b8]">
            {item?.shortName ?? MISSING_LABEL[status]}
          </span>
          {node.incompatible ? (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle className="h-3 w-3" /> Not compatible
            </span>
          ) : item ? (
            <span className="mt-0.5 block truncate text-[11px] tabular-nums text-[#888]">
              {formatErgo(item.ergonomics)} ergo
              {item.recoilModifier ? ` · ${formatRecoilModifier(item.recoilModifier)} recoil` : ""}
            </span>
          ) : null}
        </span>
      </button>
      <span className={cn("flex shrink-0 flex-col border-l border-[#1a1a1a]", compact ? "w-11" : "w-10")}>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item?.name ?? "part"}`}
          title="Remove part"
          className="flex flex-1 items-center justify-center text-[#666] transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:bg-red-950/40 focus-visible:text-red-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-red-300"
        >
          <X className="h-4 w-4" />
        </button>
        {item && (
          <Link
            href={itemHref(item)}
            prefetch={false}
            aria-label={`View ${item.name}`}
            title="View item"
            className="flex flex-1 items-center justify-center border-t border-[#1a1a1a] text-[#666] transition-colors hover:bg-[#1a1712] hover:text-[#e6d9b8] focus-visible:bg-[#1a1712] focus-visible:text-[#e6d9b8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e6d9b8]"
          >
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </span>
    </div>
  );
}
