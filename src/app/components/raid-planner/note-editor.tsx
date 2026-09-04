"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { NotePin } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
} from "@/app/lib/raid-planner/limits";

interface NoteEditorProps {
  note: NotePin;
  onChange: (changes: Partial<NotePin>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NoteEditor({ note, onChange, onDelete, onClose }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const draft = useRef({ title: note.title, body: note.body });
  const changeHandler = useRef(onChange);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discard = useRef(false);
  changeHandler.current = onChange;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!discard.current) changeHandler.current(draft.current);
  }, []);

  useEffect(() => {
    return flush;
  }, [flush]);

  function schedule(changes: Partial<Pick<NotePin, "title" | "body">>) {
    draft.current = { ...draft.current, ...changes };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  }

  return (
    <div className="flex w-64 flex-col gap-2 border border-[#2a2a2a] bg-[#090909]/95 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
          Note
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              timer.current = null;
              discard.current = true;
              onDelete();
            }}
            className="text-[#888] transition-colors hover:text-[#a04f4f]"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete note</span>
          </button>
          <button
            type="button"
            onClick={() => {
              flush();
              discard.current = true;
              onClose();
            }}
            className="text-[#888] transition-colors hover:text-[#ccc]"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close note editor</span>
          </button>
        </div>
      </div>

      <Input
        value={title}
        maxLength={MAX_NOTE_TITLE_LENGTH}
        autoFocus
        placeholder="Title"
        onChange={(event) => {
          setTitle(event.target.value);
          schedule({ title: event.target.value });
        }}
        onBlur={flush}
      />
      <textarea
        value={body}
        maxLength={MAX_NOTE_BODY_LENGTH}
        placeholder="Details, callouts, reminders…"
        rows={3}
        onChange={(event) => {
          setBody(event.target.value);
          schedule({ body: event.target.value });
        }}
        onBlur={flush}
        className="w-full resize-none border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      <div className="flex gap-1.5">
        {PLAN_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange({ color: swatch })}
            className={cn(
              "h-4 w-4 border",
              swatch === note.color ? "border-white" : "border-transparent"
            )}
            style={{ backgroundColor: swatch }}
          >
            <span className="sr-only">Use color {swatch}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
