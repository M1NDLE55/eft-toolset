"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Check, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { BuildItemData } from "@/app/lib/types/gunBuilder";
import type { PositionedNode } from "@/app/lib/builds/tree-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/app/lib/browser/clipboard";

interface BuilderNodeProps {
  node: PositionedNode;
  item: BuildItemData | null;
  onOpenPicker: () => void;
  onRemove: () => void;
  portalContainer?: HTMLElement | null;
  compact?: boolean;
}

export function BuilderNode({
  node,
  item,
  onOpenPicker,
  onRemove,
  portalContainer,
  compact = false,
}: BuilderNodeProps) {
  const isEmpty = node.kind === "empty";
  const isWeapon = node.kind === "weapon";
  const title = isEmpty ? node.slot?.name ?? "Slot" : item?.shortName ?? "Removed";
  const subtitle = isWeapon
    ? item?.caliber ?? "Weapon"
    : node.slot?.required
      ? `${node.slot.name} required`
      : node.slot?.name ?? "Mod";
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [item?.id]);

  useEffect(() => {
    if (!copied) return;

    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopyName() {
    if (!item) return;

    try {
      await copyText(item.name);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      data-builder-node
      className={[
        "group flex h-full w-full items-center gap-3 border bg-[#080808] p-3 text-left transition-colors",
        isWeapon ? "border-[#9a8866]" : "border-[#2a2a2a]",
        isEmpty ? "border-dashed hover:border-[#9a8866]" : "hover:border-[#4a4234]",
        compact ? "relative" : "absolute",
      ].join(" ")}
      style={compact ? undefined : { left: node.x, top: node.y, width: node.width, height: node.height }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={isWeapon ? undefined : onOpenPicker}
      >
        <div className="flex h-14 w-16 shrink-0 items-center justify-center border border-[#1a1a1a] bg-[#050505]">
          {isEmpty ? (
            <Plus className="h-5 w-5 text-[#9a8866]" />
          ) : item?.gridImageLink ? (
            <Image
              src={item.gridImageLink}
              alt=""
              width={64}
              height={48}
              className="max-h-12 w-auto object-contain"
            />
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
              N/A
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black uppercase tracking-widest text-[#ccc]">
            {title}
          </p>
          <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-widest text-[#888]">
            {subtitle}
          </p>
          {item && !isEmpty && (
            <p className="mt-1 truncate text-xs text-[#888]">
              {item.ergonomics > 0 ? "+" : ""}
              {item.ergonomics} ergo / {Math.round(item.weight * 100) / 100} kg
            </p>
          )}
        </div>
      </button>
      {item && !isEmpty && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open item actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" portalContainer={portalContainer}>
            <DropdownMenuItem onClick={handleCopyName}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy name
            </DropdownMenuItem>
            {!isWeapon && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpenPicker}>Swap mod</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-300" onClick={onRemove}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
