"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import Link from "next/link";
import { useLayoutEffect, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { X } from "lucide-react";
import type { ItemReference } from "@/app/lib/cache/fetcher";
import { useItem } from "@/app/lib/cache/hooks";
import type { QuestIdentity } from "@/app/lib/item-needs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ItemRundownBody, RundownImage } from "./rundown-card";
import { placeCard } from "./placement";
import { isPlainClick } from "./plain-click";

export interface RundownTarget {
  /** A new id for every open, so reopening starts afresh. */
  id: number;
  reference: ItemReference;
  name: string;
  href: string;
  /** The link that opened it: the card sits against it, and focus returns to it. */
  anchor: HTMLElement;
  quest: QuestIdentity | null;
}

/** Phones and touch screens get a bottom sheet instead of a card by the link. */
export const SHEET_QUERY = "(max-width: 639px), (pointer: coarse)";

function subscribeSheet(onChange: () => void) {
  const list = window.matchMedia?.(SHEET_QUERY);
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

function useSheet() {
  return useSyncExternalStore(
    subscribeSheet,
    () => window.matchMedia?.(SHEET_QUERY).matches === true,
    () => false
  );
}

/** Keeps the card against its link and on screen as its content loads or the window resizes. */
function useAnchoredStyle(anchor: HTMLElement, enabled: boolean) {
  // The dialog's portal mounts after this component, so follow the element itself rather than a ref.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  // Transparent, not hidden, until placed: the dialog takes focus as it mounts.
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    if (!enabled || !element) return;
    // The content inside the scrolling box: its height is what the card would take uncapped.
    const content = element.querySelector<HTMLElement>("[data-rundown-content]") ?? element;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const height = content.offsetHeight + (element.offsetHeight - element.clientHeight);
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const placement = placeCard(rect, { width: element.offsetWidth, height }, viewport);
      setStyle({ top: placement.top, left: placement.left, maxHeight: placement.maxHeight });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(content);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, element, enabled]);
  return { setElement, style };
}

function LoadingBody() {
  return (
    <div role="status" className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">Loading item details…</span>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-16" />
    </div>
  );
}

/** The item's essentials in a dialog by its link (or a bottom sheet on phones), loaded when opened. */
export function ItemRundownPopup({ target, onClose }: { target: RundownTarget; onClose: () => void }) {
  const query = useItem(target.reference);
  const item = query.item;
  const sheet = useSheet();
  const { setElement, style } = useAnchoredStyle(target.anchor, !sheet);
  const error = query.error && !item;
  const missing = !item && !query.loading && !query.error;
  // Following a link from here leaves the rundown, even to the page it's on. Caught on the way down,
  // before next/link prevents the click's default for its own navigation.
  const closeOnLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("a[href]") && isPlainClick(event)) onClose();
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50", sheet ? "bg-black/60" : "bg-transparent")} />
        <DialogPrimitive.Content
          ref={setElement}
          aria-describedby={undefined}
          data-rundown-layout={sheet ? "sheet" : "card"}
          style={sheet ? undefined : style}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-[#2a2a2a] bg-[#0b0b0b] text-[#ccc] shadow-2xl shadow-black/60 outline-none",
            sheet
              ? "inset-x-0 bottom-0 max-h-[85dvh] border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)]"
              : "w-88 max-w-[calc(100vw-16px)]"
          )}
          onOpenAutoFocus={(event) => {
            // Start on the dialog itself, so a screen reader reads its name first.
            event.preventDefault();
            if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (target.anchor.isConnected) target.anchor.focus({ preventScroll: true });
          }}
          tabIndex={-1}
          onClickCapture={closeOnLink}
        >
          {/* The box scrolls inside the dialog, so the close button stays put. */}
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div data-rundown-content className="flex flex-col gap-3 p-3">
              {sheet && <span aria-hidden className="mx-auto -mt-1 h-1 w-10 rounded-full bg-[#333]" />}
              <div className="flex items-start gap-3 pr-8">
                <RundownImage item={item} />
                <div className="flex min-w-0 flex-col gap-1">
                  <DialogPrimitive.Title className="text-base font-semibold leading-tight text-[#eee]">{item?.name ?? target.name}</DialogPrimitive.Title>
                  {item?.shortName && item.shortName !== item.name && (
                    <span className="self-start border border-[#2a2a2a] px-1.5 py-0.5 text-2xs uppercase tracking-wider text-[#999]">
                      {item.shortName}
                    </span>
                  )}
                </div>
              </div>
              {item ? (
                <ItemRundownBody item={item} quest={target.quest} />
              ) : error ? (
                <p role="alert" className="text-sm text-[#bbb]">
                  Couldn&apos;t load this item&apos;s details. The full page may still have them.
                </p>
              ) : missing ? (
                <p className="text-sm text-[#bbb]">No details for this item in this game mode.</p>
              ) : (
                <LoadingBody />
              )}
              <Link
                href={target.href}
                className="inline-flex h-9 items-center justify-center border border-[#3a3326] bg-[#1a1610] text-xs font-bold uppercase tracking-widest text-[#e6d9b8] hover:border-[#9a8866] focus-visible:outline-2 focus-visible:outline-[#c8b384]"
              >
                Open full page
              </Link>
            </div>
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center text-[#888] hover:text-[#eee] focus-visible:outline-2 focus-visible:outline-[#c8b384]"
          >
            <X aria-hidden className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
