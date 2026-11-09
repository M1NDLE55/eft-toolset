"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { copyText } from "@/app/lib/browser/clipboard";

export default function Share({ title }: { title: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title, url });
        return;
      }
      await copyText(url);
      setStatus("copied");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setStatus("error");
    }
    window.setTimeout(() => setStatus("idle"), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-live="polite"
      aria-label={status === "idle" ? "Share this item" : undefined}
      className="flex h-9 shrink-0 items-center gap-1.5 border border-[#2a2a2a] px-2.5 text-[11px] font-bold uppercase tracking-widest text-[#aaa] transition-colors hover:border-[#9a8866] hover:text-[#e6d9b8]"
    >
      {status === "copied" ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
      <span className={status === "idle" ? "hidden sm:inline" : undefined}>
        {status === "copied" ? "Copied" : status === "error" ? "Failed" : "Share"}
      </span>
    </button>
  );
}
