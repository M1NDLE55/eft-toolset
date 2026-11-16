"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { GameModeToggle } from "@/components/game-mode/toggle";
import { LayoutPreview } from "@/app/components/home/layout-previews";
import { useHydrated } from "@/app/lib/storage/use-store";
import { DEFAULT_HOME_LAYOUT, HOME_LAYOUTS, setHomeLayout, useHomeLayout, type HomeLayout } from "@/app/lib/settings/store";
import { cn } from "@/lib/utils";

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-[#1a1a1a] pt-6">
      <div>
        <h2 id={id} className="text-xs font-bold uppercase tracking-widest text-[#c8b384]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-[#888]">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function Page() {
  const hydrated = useHydrated();
  const stored = useHomeLayout();
  const [fallback, setFallback] = useState<HomeLayout | null>(null);
  const [error, setError] = useState("");
  const selected = fallback ?? stored;

  const choose = (layout: HomeLayout) => {
    try {
      setHomeLayout(layout);
      setFallback(null);
      setError("");
    } catch (reason) {
      setFallback(layout);
      setError(reason instanceof Error ? reason.message : "Could not save this setting.");
    }
  };

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:py-10">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Settings</h1>
          <p className="mt-1 text-sm text-[#888]">Saved in this browser and included in your backup.</p>
        </div>

        <Section
          id="home-screen"
          title="Home screen"
          description="Pick what the home page shows. Each one keeps the item search and links to every tool."
        >
          <div role="radiogroup" aria-labelledby="home-screen" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {HOME_LAYOUTS.map((layout) => {
              const active = hydrated && selected === layout.id;
              return (
                <button
                  key={layout.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => choose(layout.id)}
                  className={cn(
                    "group flex flex-col gap-3 border bg-[#0c0c0c] p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9a8866]",
                    active ? "border-[#9a8866]" : "border-[#1a1a1a] hover:border-[#3a3a3a]"
                  )}
                >
                  <LayoutPreview layout={layout.id} />
                  <span className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border",
                        active ? "border-[#9a8866] bg-[#9a8866] text-black" : "border-[#3a3a3a]"
                      )}
                    >
                      {active && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#ddd]">
                        {layout.name}
                        {layout.id === DEFAULT_HOME_LAYOUT && (
                          <span className="border border-[#2a2a2a] px-1.5 py-0.5 text-[9px] text-[#888]">Default</span>
                        )}
                      </span>
                      <span className="text-sm text-[#888]">{layout.description}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
        </Section>

        <Section id="game-mode" title="Game mode" description="Switches every price and data set between PVP and PVE. The same switch is in the header.">
          <GameModeToggle />
        </Section>

        <Section id="your-data" title="Your data" description="Groups, builds, plans and these settings live only in this browser.">
          <Link
            href="/data"
            className="self-start text-xs font-bold uppercase tracking-widest text-[#c8b384] underline underline-offset-4 hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
          >
            Back up or restore
          </Link>
        </Section>
      </div>
    </main>
  );
}
