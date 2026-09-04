"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { copyText } from "@/app/lib/browser/clipboard";

export default function Share() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  async function handleShare() {
    try {
      const url = window.location.href;
      if (navigator.share) await navigator.share({ url });
      else {
        await copyText(url);
        setStatus("copied");
        window.setTimeout(() => setStatus("idle"), 1500);
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setStatus("error");
      }
    }
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1 hover:text-yellow-400 transition-colors"
    >
      {status === "copied" ? "Copied" : status === "error" ? "Share failed" : "Share"}{" "}
      {status === "copied" ? <Check size={20} className="inline" /> : <Share2 size={20} className="inline" />}
    </button>
  );
}
