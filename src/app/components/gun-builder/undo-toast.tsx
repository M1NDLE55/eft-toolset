"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

export function UndoToast({ label, onUndo }: { label: string | null; onUndo: () => void }) {
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement,
    () => null
  );
  const toast = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      {label && (
        <div className="pointer-events-auto flex max-w-full items-center gap-3 border border-[#2a2a2a] bg-[#0c0c0c] py-1.5 pl-4 pr-1.5 shadow-2xl">
          <span className="truncate text-sm text-[#ccc]">{label}</span>
          <Button size="sm" variant="outline" onClick={onUndo}>
            Undo
          </Button>
        </div>
      )}
    </div>
  );
  return fullscreen instanceof HTMLElement ? createPortal(toast, fullscreen) : toast;
}
