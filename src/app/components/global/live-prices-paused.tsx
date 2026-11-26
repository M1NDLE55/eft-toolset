"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "@tanstack/react-router";
import { PauseCircle, X } from "lucide-react";
import {
  continueLivePrices,
  isLivePricesPaused,
  livePricesPublishedAt,
  renewLivePricesOnNavigation,
  subscribeLivePricesPaused,
} from "@/app/lib/prices/live-prices";

/** "14:32 (12 min ago)": the time tarkov.dev published the prices on the page, and how long ago. */
function priceAge(publishedAt: string | null, now: number) {
  const time = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const clock = new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  const ago = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
  return `${clock} (${ago})`;
}

/**
 * Live prices last 30 minutes (live-prices.ts). When they pause, this asks whether to continue; until
 * then the page keeps its prices, and this says how old they are. Dismissed, it shrinks to the age and
 * a resume button. A navigation starts another 30 minutes, as a reload does.
 */
export function LivePricesPaused() {
  const router = useRouter();
  const paused = useSyncExternalStore(subscribeLivePricesPaused, isLivePricesPaused, () => false);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      router.subscribe("onResolved", (event) => {
        if (event.pathChanged) renewLivePricesOnNavigation();
      }),
    [router]
  );

  useEffect(() => {
    if (!paused) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [paused]);

  if (!paused) return null;
  const age = priceAge(livePricesPublishedAt(), now);
  const resume = () => {
    setDismissed(false);
    continueLivePrices();
  };

  if (dismissed) {
    return (
      <div className="pointer-events-none fixed bottom-3 left-3 z-1100">
        <button
          type="button"
          onClick={resume}
          className="pointer-events-auto flex items-center gap-2 border border-[#2a2a2a] bg-[#0c0c0c] px-3 py-2 text-xs text-[#bbb] shadow-lg hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
        >
          <PauseCircle className="h-3.5 w-3.5 text-[#9a8866]" aria-hidden />
          {age ? `Prices from ${age}` : "Live prices paused"}
          <span className="font-bold text-[#c8b384]">Resume</span>
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-1100 max-w-[calc(100vw-1.5rem)]">
      <div role="status" className="pointer-events-auto flex max-w-sm items-start gap-3 border border-[#2a2a2a] bg-[#0c0c0c] p-3 text-xs text-[#bbb] shadow-lg">
        <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a8866]" aria-hidden />
        <div className="flex min-w-0 flex-col gap-2">
          <p>
            Live prices paused because the page has been idle.
            {age && <span className="text-[#888]"> Prices shown are from {age}.</span>}
          </p>
          <button
            type="button"
            onClick={resume}
            className="self-start border border-[#5a4a26] bg-[#16130b] px-2.5 py-1 font-bold text-[#e2c98a] hover:bg-[#1f1a0f] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
          >
            Continue live prices
          </button>
        </div>
        <button type="button" title="Dismiss" onClick={() => setDismissed(true)} className="text-[#888] hover:text-[#ddd]">
          <X className="h-4 w-4" aria-hidden />
          <span className="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  );
}
