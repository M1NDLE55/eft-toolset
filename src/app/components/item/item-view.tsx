"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CARD_GROUPS,
  ITEM_CARDS,
  MAX_VIEW_NAME,
  PRESET_DESCRIPTIONS,
  isItemCardId,
  isPresetId,
  type ItemView,
  type ViewCard,
} from "@/app/lib/item-views/views";
import { copyView, deleteView, setActiveView, updateView, useItemViews } from "@/app/lib/item-views/store";
import { cn } from "@/lib/utils";
import { CardGrid } from "./card-grid";
import { ItemHeader } from "./item-header";
import { ItemBreadcrumb } from "./item-faq";
import type { CardContext } from "./cards";

function ViewTabs({ views, active, onSelect }: { views: ItemView[]; active: string; onSelect: (id: string) => void }) {
  return (
    <div role="group" aria-label="Item page view" className="flex max-w-full overflow-x-auto border border-[#1a1a1a]">
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={view.id === active}
          title={PRESET_DESCRIPTIONS[view.id] ?? "Your view"}
          onClick={() => onSelect(view.id)}
          className={cn(
            "h-8 shrink-0 px-3 text-2xs font-bold uppercase tracking-widest transition-colors",
            view.id === active ? "bg-[#c8b384] text-black" : "text-[#888] hover:bg-[#111] hover:text-[#ccc]"
          )}
        >
          <span className="block max-w-36 truncate">{view.name}</span>
        </button>
      ))}
    </div>
  );
}

function AddCardMenu({ cards, onAdd }: { cards: ViewCard[]; onAdd: (id: ViewCard["id"]) => void }) {
  const shown = new Set(cards.map((entry) => entry.id));
  const missing = Object.keys(ITEM_CARDS).filter(isItemCardId).filter((id) => !shown.has(id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8" disabled={missing.length === 0}>
          <Plus /> Add card
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
        {CARD_GROUPS.map((group, index) => {
          const ids = missing.filter((id) => ITEM_CARDS[id].group === group);
          if (ids.length === 0) return null;
          return (
            <DropdownMenuGroup key={group}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-3xs uppercase tracking-widest text-[#9a8866]">{group}</DropdownMenuLabel>
              {ids.map((id) => (
                <DropdownMenuItem key={id} onSelect={() => onAdd(id)} className="flex flex-col items-start gap-0.5">
                  <span className="text-sm text-[#ddd]">{ITEM_CARDS[id].title}</span>
                  <span className="text-xs text-[#888]">{ITEM_CARDS[id].description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ItemPageView({ context }: { context: CardContext }) {
  const { views, active, hydrated } = useItemViews();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const custom = !isPresetId(active.id);
  const isEditing = editing && custom && hydrated;

  const attempt = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the view.");
    }
  };

  const changeCards = (cards: ViewCard[]) => attempt(() => updateView(active.id, { cards }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ItemBreadcrumb name={context.item.name} />
        {isEditing ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="view-name">
              View name
            </label>
            <input
              id="view-name"
              key={active.id}
              defaultValue={active.name}
              maxLength={MAX_VIEW_NAME}
              onChange={(event) => {
                const name = event.target.value;
                if (name.trim()) attempt(() => updateView(active.id, { name }));
              }}
              className="h-8 w-44 border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-sm text-[#ddd] focus-visible:border-[#9a8866] focus-visible:outline-none"
            />
            <AddCardMenu
              cards={active.cards}
              onAdd={(id) => changeCards([...active.cards, { id, w: ITEM_CARDS[id].width }])}
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" className="h-8" aria-label="Delete this view">
                  <Trash2 />
                </Button>
              }
              title={`Delete “${active.name}”?`}
              description="The view is removed from this browser. Item pages go back to the Standard view."
              confirmLabel="Delete view"
              onConfirm={() => {
                attempt(() => deleteView(active.id));
                setEditing(false);
              }}
            />
            <Button size="sm" className="h-8" onClick={() => setEditing(false)}>
              <Check /> Done
            </Button>
          </div>
        ) : (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <ViewTabs views={views} active={active.id} onSelect={(id) => attempt(() => setActiveView(id))} />
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              disabled={!hydrated}
              title={custom ? "Move, resize, add and remove cards" : "Make your own view, starting from this one"}
              onClick={() =>
                attempt(() => {
                  if (!custom) copyView(active);
                  setEditing(true);
                })
              }
            >
              <Pencil /> {custom ? "Edit" : "Customise"}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {isEditing && (
        <p className="text-xs text-[#888]">
          Drag a card&apos;s grip to move it and its right edge to resize it; both also take the arrow keys. Cards with
          nothing for this item stay hidden outside editing. Views are saved in this browser.
        </p>
      )}
      <ItemHeader item={context.item} />
      <CardGrid cards={active.cards} context={context} editing={isEditing} onChange={changeCards} />
    </div>
  );
}
