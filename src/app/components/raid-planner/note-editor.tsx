"use client";

import { useEffect, useEffectEvent, useId, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { NotePin } from "@/app/lib/raid-planner/types";
import { getPlanDisplayColor, PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { MAX_NOTE_BODY_LENGTH, MAX_NOTE_TITLE_LENGTH } from "@/app/lib/raid-planner/limits";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { focusRing, iconButton, overlayPanel } from "./ui";

interface NoteEditorProps {
  note: NotePin;
  onChange: (changes: Partial<NotePin>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NoteEditor({ note, onChange, onDelete, onClose }: NoteEditorProps) {
  const [draft, setDraft] = useState({ title: note.title, body: note.body, base: note });
  if (draft.base.title !== note.title || draft.base.body !== note.body) {
    setDraft({ title: note.title, body: note.body, base: note });
  }
  const { title, body } = draft;
  const setTitle = (value: string) => setDraft((current) => ({ ...current, title: value }));
  const setBody = (value: string) => setDraft((current) => ({ ...current, body: value }));
  const titleId = useId();
  const activeColor = getPlanDisplayColor(note.color);

  const commit = useEffectEvent(() => {
    if (title !== note.title || body !== note.body) onChange({ title, body });
  });

  useEffect(() => {
    const timer = setTimeout(commit, 400);
    return () => clearTimeout(timer);
  }, [title, body]);

  useEffect(() => () => commit(), []);

  return (
    <section
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className={cn(overlayPanel, "flex w-full flex-col gap-2 bg-[#090909]/97 p-3 sm:w-72")}
    >
      <header className="-mr-2 -mt-2 flex items-center justify-between">
        <h2 id={titleId} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
          <span aria-hidden className="size-2.5" style={{ backgroundColor: activeColor }} />
          Note
        </h2>
        <div className="flex items-center">
          <button type="button" onClick={onDelete} className={cn(iconButton, "hover:text-red-300")}>
            <Trash2 className="h-4 w-4" aria-hidden />
            <span className="sr-only">Delete note</span>
          </button>
          <button type="button" onClick={onClose} className={iconButton}>
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close note editor</span>
          </button>
        </div>
      </header>

      <Input
        value={title}
        maxLength={MAX_NOTE_TITLE_LENGTH}
        autoFocus={!note.title && !note.body}
        aria-label="Note title"
        placeholder="Title"
        onChange={(event) => setTitle(event.target.value)}
        className="max-sm:text-base"
      />
      <textarea
        value={body}
        maxLength={MAX_NOTE_BODY_LENGTH}
        aria-label="Note details"
        placeholder="Details, callouts, reminders…"
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        className="w-full resize-none border border-input bg-transparent px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring sm:text-sm"
      />

      <div role="group" aria-label="Note color" className="-mx-1 flex">
        {PLAN_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange({ color: swatch })}
            aria-pressed={swatch === activeColor}
            className={cn("flex size-10 items-center justify-center sm:size-8", focusRing)}
          >
            <span
              aria-hidden
              className={cn("block size-5 border-2", swatch === activeColor ? "border-white" : "border-black/40")}
              style={{ backgroundColor: swatch }}
            />
            <span className="sr-only">Use color {swatch}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
