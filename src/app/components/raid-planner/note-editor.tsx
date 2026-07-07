"use client";

import { Trash2, X } from "lucide-react";
import type { NotePin } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NoteEditorProps {
  note: NotePin;
  onChange: (changes: Partial<NotePin>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NoteEditor({ note, onChange, onDelete, onClose }: NoteEditorProps) {
  return (
    <div className="flex w-64 flex-col gap-2 border border-[#2a2a2a] bg-[#090909]/95 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
          Note
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="text-[#777] transition-colors hover:text-[#a04f4f]"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete note</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[#777] transition-colors hover:text-[#ccc]"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close note editor</span>
          </button>
        </div>
      </div>

      <Input
        value={note.title}
        autoFocus
        placeholder="Title"
        onChange={(event) => onChange({ title: event.target.value })}
      />
      <textarea
        value={note.body}
        placeholder="Details, callouts, reminders…"
        rows={3}
        onChange={(event) => onChange({ body: event.target.value })}
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
