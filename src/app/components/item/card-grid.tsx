"use client";

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripVertical, X } from "lucide-react";
import { ITEM_CARDS, moveCard, type CardWidth, type ItemCardId, type ViewCard } from "@/app/lib/item-views/views";
import { placeCards } from "@/app/lib/item-views/placement";
import { cn } from "@/lib/utils";
import { CARD_DEFINITIONS, type CardContext } from "./cards";

// Cards sit on rows ROW px tall with no gap, each spanning the rows its content needs, so short
// cards fill the space beside tall ones. placement.ts keeps each card's column until the layout
// itself changes, so a card growing only pushes down what's below it. Until the grid has measured
// its cards (and on the server) it lays out in ordinary rows. Columns come from the grid's own
// width, in globals.css (.item-grid); PHONE_WIDTH matches its narrowest step.
const ROW = 4;
const GAP = 12;
const PHONE_WIDTH = 520;

/** Columns a card spans: its width, capped; on phones only single figures share a row. */
function spanOf(entry: ViewCard, columns: number, phone: boolean) {
  if (phone) return CARD_DEFINITIONS[entry.id].stat ? 1 : columns;
  return Math.min(entry.w, columns);
}

function CardFrame({
  id,
  context,
  editing,
  empty,
  children,
  toolbar,
}: {
  id: ItemCardId;
  context: CardContext;
  editing: boolean;
  empty: boolean;
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  const definition = CARD_DEFINITIONS[id];
  const count = definition.count?.(context);
  const titleId = `card-${id}`;
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col border bg-[#0c0c0c]",
        editing ? "border-[#2a2a2a]" : "border-[#1a1a1a]",
        empty && "opacity-60"
      )}
    >
      <header className="flex min-h-8 items-center gap-2 px-3 pt-2">
        <h2 id={titleId} className="flex min-w-0 items-baseline gap-2 text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
          <span className="truncate">{ITEM_CARDS[id].title}</span>
          {count !== undefined && <span className="text-[#666]">{count}</span>}
        </h2>
        {toolbar}
      </header>
      <div className={cn("px-3 pb-3", definition.stat ? "pt-0.5" : "pt-1.5")}>
        {empty ? <p className="text-sm text-[#777]">{definition.emptyText ?? "Nothing for this item."}</p> : children}
      </div>
    </section>
  );
}

function GridCard({
  entry,
  context,
  editing,
  dragging,
  onResize,
  onRemove,
  onHandlePointerDown,
  onHandleKeyDown,
  onPreviewSpan,
  register,
}: {
  entry: ViewCard;
  context: CardContext;
  editing: boolean;
  dragging: boolean;
  onResize: (width: CardWidth) => void;
  onRemove: () => void;
  onHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Shows the card at a span while its edge is dragged; null goes back to its width. */
  onPreviewSpan: (span: number | null) => void;
  register: (id: string, wrapper: HTMLDivElement | null) => void;
}) {
  const outer = useRef<HTMLDivElement | null>(null);
  const definition = CARD_DEFINITIONS[entry.id];
  const empty = definition.empty?.(context) ?? false;
  const title = ITEM_CARDS[entry.id].title;
  // While the right edge is dragged: the span shown so far, of the columns there are.
  const [resizing, setResizing] = useState<{ span: number; columns: number } | null>(null);

  // Dragging the right edge snaps the card to whole columns, previewed live; it's saved on release.
  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    const wrapper = outer.current;
    const grid = wrapper?.parentElement;
    if (event.button !== 0 || !wrapper || !grid) return;
    event.preventDefault();
    const style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length;
    const gap = parseFloat(style.columnGap) || 0;
    const column = (grid.getBoundingClientRect().width - gap * (columns - 1)) / columns;
    const rect = wrapper.getBoundingClientRect();
    let span = Math.max(1, Math.round((rect.width + gap) / (column + gap)));
    setResizing({ span, columns });
    document.body.style.cursor = "ew-resize";
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = Math.min(columns, Math.max(1, Math.round((moveEvent.clientX - rect.left + gap) / (column + gap))));
      if (next === span) return;
      span = next;
      onPreviewSpan(next);
      setResizing({ span, columns });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = "";
      setResizing(null);
      // Full width on a narrower screen keeps a card that was already wider than that as wide.
      const width = (span === columns && entry.w > span ? entry.w : span) as CardWidth;
      if (commit && width !== entry.w) onResize(width);
      // Let the saved width render before dropping the preview, so the card doesn't flicker.
      requestAnimationFrame(() => onPreviewSpan(null));
    };
    const release = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
  };

  const resizeKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const width = Math.min(4, Math.max(1, entry.w + step)) as CardWidth;
    if (!step) return;
    event.preventDefault();
    if (width !== entry.w) onResize(width);
  };

  const toolbar = editing && (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 text-[#888]">
      <button
        type="button"
        aria-label={`Move ${title}: drag, or use the arrow keys`}
        title="Drag to move"
        onPointerDown={onHandlePointerDown}
        onKeyDown={onHandleKeyDown}
        className="flex h-7 w-7 cursor-grab touch-none items-center justify-center hover:bg-[#1a1a1a] hover:text-[#ddd] active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${title}`}
        onClick={onRemove}
        className="flex h-7 w-7 items-center justify-center hover:bg-[#1a1a1a] hover:text-red-300"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
  return (
    <div
      ref={useCallback(
        (node: HTMLDivElement | null) => {
          outer.current = node;
          register(entry.id, node);
        },
        [register, entry.id]
      )}
      data-card={entry.id}
      data-w={entry.w}
      data-stat={definition.stat ? "" : undefined}
      className={cn(
        "relative min-w-0",
        dragging && "pointer-events-none z-20 shadow-[0_12px_40px_rgba(0,0,0,0.8)] [&>div>section]:border-[#9a8866]",
        resizing && "z-10 [&>div>section]:border-[#c8b384]"
      )}
    >
      <div>
        <CardFrame id={entry.id} context={context} editing={editing} empty={empty} toolbar={toolbar}>
          {definition.render(context)}
        </CardFrame>
      </div>
      {editing && (
        <button
          type="button"
          aria-label={`Resize ${title}, ${entry.w} of 4 columns wide: drag, or use the left and right arrow keys`}
          title="Drag to resize"
          onPointerDown={startResize}
          onKeyDown={resizeKey}
          className="group absolute top-0 bottom-3 -right-[10px] z-10 flex w-4 cursor-ew-resize touch-none items-center justify-center focus-visible:outline-none"
        >
          <span
            className={cn(
              "flex h-12 w-1.5 items-center justify-center transition-colors",
              resizing ? "bg-[#c8b384]" : "bg-[#3a3326] group-hover:bg-[#c8b384] group-focus-visible:bg-[#c8b384]"
            )}
          />
        </button>
      )}
      {resizing && (
        <span className="pointer-events-none absolute -top-2.5 right-3 z-20 bg-[#c8b384] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-black">
          {resizing.span} of {resizing.columns} columns
        </span>
      )}
    </div>
  );
}

interface Drop {
  index: number;
  target: HTMLElement;
  /** Where the marker goes: a side of the target, or for full-width cards its top or bottom. */
  edge: "left" | "right" | "top" | "bottom";
}

/** Where a pointer over a card would drop the dragged one: before or after that card. */
function dropAt(cards: readonly ViewCard[], dragged: ItemCardId, x: number, y: number, grid: HTMLElement): Drop | null {
  const target = document
    .elementsFromPoint(x, y)
    .map((element) => (element as HTMLElement).closest<HTMLElement>("[data-card]"))
    .find((element) => element && element.dataset.card !== dragged && grid.contains(element));
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  // A card as wide as the grid only has a top and a bottom; otherwise its sides decide.
  const fullWidth = rect.width > grid.getBoundingClientRect().width * 0.9;
  const after = fullWidth ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2;
  const others = cards.filter((entry) => entry.id !== dragged);
  const at = others.findIndex((entry) => entry.id === target.dataset.card);
  if (at < 0) return null;
  const edge = fullWidth ? (after ? "bottom" : "top") : after ? "right" : "left";
  return { index: at + (after ? 1 : 0), target, edge };
}

export function CardGrid({
  cards,
  context,
  editing,
  onChange,
}: {
  cards: ViewCard[];
  context: CardContext;
  editing: boolean;
  onChange: (cards: ViewCard[]) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<ItemCardId | null>(null);
  // Pointer handlers outlive renders; they read the cards as they are now.
  const latest = useRef(cards);
  useLayoutEffect(() => {
    latest.current = cards;
  });

  const shown = editing ? cards : cards.filter((entry) => !(CARD_DEFINITIONS[entry.id].empty?.(context) ?? false));

  // Layout state lives outside React: measuring and placing happens before paint, on every render
  // and whenever a card's content or the grid's width changes.
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const heights = useRef(new Map<string, number>());
  const previews = useRef(new Map<string, number>());
  const kept = useRef<{ key: string; columns: Map<string, number> }>({ key: "", columns: new Map() });
  const shownNow = useRef(shown);
  const observer = useRef<ResizeObserver | null>(null);

  const measure = (wrapper: HTMLDivElement) => {
    const content = wrapper.firstElementChild;
    const id = wrapper.dataset.card;
    if (content && id) heights.current.set(id, Math.max(1, Math.ceil((content.getBoundingClientRect().height + GAP) / ROW)));
  };

  const layout = () => {
    const element = grid.current;
    if (!element) return;
    const columns = getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const phone = element.getBoundingClientRect().width < PHONE_WIDTH;
    const boxes = shownNow.current.map((entry) => ({
      id: entry.id,
      span: previews.current.get(entry.id) ?? spanOf(entry, columns, phone),
      rows: heights.current.get(entry.id) ?? 1,
    }));
    // A new item, view, order, width or column count chooses columns afresh; anything else keeps them.
    const key = [context.item.id, columns, ...boxes.map((box) => `${box.id}.${box.span}`)].join(",");
    if (key !== kept.current.key) kept.current = { key, columns: new Map() };
    for (const [id, place] of placeCards(boxes, columns, kept.current.columns)) {
      kept.current.columns.set(id, place.column);
      const wrapper = wrappers.current.get(id);
      if (!wrapper) continue;
      wrapper.style.gridColumn = `${place.column + 1} / span ${place.span}`;
      wrapper.style.gridRow = `${place.row + 1} / span ${place.rows}`;
    }
    element.setAttribute("data-packed", "");
  };

  const observe = () => {
    observer.current ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const wrapper = (entry.target as HTMLElement).parentElement;
        if (wrapper instanceof HTMLDivElement && wrapper.dataset.card) measure(wrapper);
      }
      layout();
    });
    return observer.current;
  };

  const register = (id: string, wrapper: HTMLDivElement | null) => {
    const previous = wrappers.current.get(id);
    if (previous?.firstElementChild && previous !== wrapper) observer.current?.unobserve(previous.firstElementChild);
    if (!wrapper) {
      wrappers.current.delete(id);
      return;
    }
    wrappers.current.set(id, wrapper);
    if (wrapper.firstElementChild) observe().observe(wrapper.firstElementChild);
  };

  useLayoutEffect(() => {
    shownNow.current = shown;
    for (const wrapper of wrappers.current.values()) measure(wrapper);
    layout();
  });

  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const widths = new ResizeObserver(() => layout());
    widths.observe(element);
    return () => {
      widths.disconnect();
      observer.current?.disconnect();
    };
    // layout reads everything it needs from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The card follows the pointer and a marker shows where it will land; cards only move on release,
  // so nothing shifts under the pointer mid-drag. Listening on window keeps the drag going wherever
  // the pointer goes.
  const startDrag = (id: ItemCardId) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !grid.current) return;
    event.preventDefault();
    const card = event.currentTarget.closest<HTMLElement>("[data-card]");
    if (!card) return;
    const origin = { x: event.clientX, y: event.clientY };
    let drop: Drop | null = null;
    setDragging(id);
    const mark = (next: Drop | null) => {
      if (drop?.target === next?.target && drop?.edge === next?.edge) return;
      drop?.target.removeAttribute("data-drop");
      next?.target.setAttribute("data-drop", next.edge);
      drop = next;
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      card.style.transform = `translate(${moveEvent.clientX - origin.x}px, ${moveEvent.clientY - origin.y}px)`;
      if (grid.current) mark(dropAt(latest.current, id, moveEvent.clientX, moveEvent.clientY, grid.current));
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      card.style.transform = "";
      const index = drop?.index;
      mark(null);
      setDragging(null);
      if (commit && index !== undefined) onChange(moveCard(latest.current, id, index));
    };
    const release = () => finish(true);
    const cancel = () => finish(false);
    const escape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
  };

  const keyMove = (id: ItemCardId) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const from = cards.findIndex((entry) => entry.id === id);
    onChange(moveCard(cards, id, from + step));
    // Keep focus on the handle as the card moves.
    const handle = event.currentTarget;
    requestAnimationFrame(() => handle.focus());
  };

  return (
    <div className="item-grid-host">
      <div ref={grid} className="item-grid">
        {shown.map((entry) => (
          <GridCard
            key={entry.id}
            entry={entry}
            context={context}
            editing={editing}
            dragging={dragging === entry.id}
            onResize={(w) => onChange(cards.map((card) => (card.id === entry.id ? { ...card, w } : card)))}
            onRemove={() => onChange(cards.filter((card) => card.id !== entry.id))}
            onHandlePointerDown={startDrag(entry.id)}
            onHandleKeyDown={keyMove(entry.id)}
            onPreviewSpan={(span) => {
              if (span === null) previews.current.delete(entry.id);
              else previews.current.set(entry.id, span);
              layout();
            }}
            register={register}
          />
        ))}
      </div>
    </div>
  );
}
