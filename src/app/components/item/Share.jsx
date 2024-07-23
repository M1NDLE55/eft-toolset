"use client";

import { Share2 } from "lucide-react";

export default function Share() {
  async function handleShare() {
    try {
      await navigator.share({ url: "" });
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1 hover:text-yellow-400 transition-colors"
    >
      Share <Share2 size={20} className="inline" />
    </button>
  );
}
