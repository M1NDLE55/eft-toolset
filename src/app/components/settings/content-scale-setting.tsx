"use client";

import { useState } from "react";
import { applyContentScale, CONTENT_SCALES, contentScalePercent, type ContentScale } from "@/app/lib/settings/content-scale";
import { setContentScale, useContentScale } from "@/app/lib/settings/store";
import { useHydrated } from "@/app/lib/storage/use-store";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ContentScale; label: string }[] = [
  { value: "default", label: `Default (${contentScalePercent("default")}%)` },
  ...CONTENT_SCALES.map((percent) => ({ value: percent, label: `${percent}%` })),
];

export function ContentScaleSetting() {
  const hydrated = useHydrated();
  const stored = useContentScale();
  const [fallback, setFallback] = useState<ContentScale | null>(null);
  const [error, setError] = useState("");
  const selected = fallback ?? stored;

  const choose = (scale: ContentScale) => {
    try {
      setContentScale(scale);
      setFallback(null);
      setError("");
    } catch (reason) {
      // Not saved, but still shown for this page so the selected option matches what you see.
      applyContentScale(document.documentElement, scale);
      setFallback(scale);
      setError(reason instanceof Error ? reason.message : "Could not save this setting.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-labelledby="content-size-title" className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => {
          const active = hydrated && selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(option.value)}
              className={cn(
                "h-10 border px-3 text-2xs font-bold uppercase tracking-widest tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9a8866]",
                active ? "border-[#9a8866] bg-[#9a8866] text-black" : "border-[#2a2a2a] bg-[#0c0c0c] text-[#888] hover:border-[#3a3a3a] hover:text-[#ccc]"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
