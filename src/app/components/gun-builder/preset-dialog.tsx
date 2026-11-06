"use client";

import { useState } from "react";
import { Eraser, Layers, LoaderCircle } from "lucide-react";
import type { BuildItemData } from "@/app/lib/types/gunBuilder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function PresetDialog({
  weapon,
  hasParts,
  onLoad,
  onClear,
}: {
  weapon: BuildItemData | null;
  hasParts: boolean;
  onLoad: (presetId: string, name: string) => Promise<void>;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const presets = weapon?.presets ?? [];

  async function load(presetId: string, name: string) {
    setLoading(presetId);
    setError("");
    try {
      await onLoad(presetId, name);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this preset.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return;
        setOpen(next);
        setError("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!weapon} aria-label="Presets">
          <Layers />
          <span className="max-lg:sr-only">Presets</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">
            Presets
          </DialogTitle>
          <DialogDescription>
            Loading a preset replaces every part on this build. You can undo it afterwards.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[50dvh] flex-col overflow-y-auto border border-[#1a1a1a] bg-[#080808]">
          {presets.map((preset) => (
            <li key={preset.id} className="border-t border-[#141414] first:border-t-0">
              <button
                type="button"
                disabled={Boolean(loading)}
                onClick={() => load(preset.id, preset.name)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-[#ddd] transition-colors hover:bg-[#121212] hover:text-[#e6d9b8] focus-visible:bg-[#121212] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866] disabled:opacity-50"
              >
                <span className="min-w-0 truncate">{preset.name}</span>
                {loading === preset.id && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[#9a8866]" />}
              </button>
            </li>
          ))}
          {presets.length === 0 && (
            <li className="p-4 text-center text-sm text-[#888]">This weapon has no presets.</li>
          )}
        </ul>
        {error && (
          <p role="alert" className="border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <Button
          variant="outline"
          disabled={!hasParts || Boolean(loading)}
          onClick={() => {
            onClear();
            setOpen(false);
          }}
        >
          <Eraser /> Strip all parts
        </Button>
      </DialogContent>
    </Dialog>
  );
}
