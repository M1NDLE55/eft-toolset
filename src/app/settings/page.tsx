"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { GameModeToggle } from "@/components/game-mode/toggle";
import { LayoutPreview } from "@/app/components/home/layout-previews";
import { CopySnippet } from "@/app/components/mcp/copy-snippet";
import { AccountSection } from "@/app/components/settings/account-section";
import { useHydrated } from "@/app/lib/storage/use-store";
import { DEFAULT_HOME_LAYOUT, HOME_LAYOUTS, setHomeLayout, useHomeLayout, type HomeLayout } from "@/app/lib/settings/store";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "account", title: "Account" },
  { id: "ai-assistants", title: "AI assistants" },
  { id: "home-screen", title: "Home screen" },
  { id: "game-mode", title: "Game mode" },
  { id: "data", title: "Your data" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const linkClass =
  "text-xs font-bold uppercase tracking-widest text-[#c8b384] underline underline-offset-4 hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]";

function Section({ id, description, children }: { id: SectionId; description: string; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)!.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-4 border-t border-[#1a1a1a] pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 id={`${id}-title`} className="text-xs font-bold uppercase tracking-widest text-[#c8b384]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-[#888]">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** The section at the top of the viewport: the last one whose heading has scrolled past the top, or the last at the bottom of the page. */
function useActiveSection() {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: SectionId = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id);
        if (element && (atBottom || element.getBoundingClientRect().top <= 120)) current = section.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return active;
}

function SectionNav() {
  const active = useActiveSection();
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-6 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {SECTIONS.map((section) => (
          <li key={section.id} className="shrink-0">
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "location" : undefined}
              className={cn(
                "block border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-[#9a8866] lg:border-0 lg:border-l-2",
                active === section.id
                  ? "border-[#9a8866] text-[#c8b384]"
                  : "border-[#1a1a1a] text-[#888] hover:border-[#3a3a3a] hover:text-[#ccc] lg:border-transparent"
              )}
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
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
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Settings</h1>
          <p className="mt-1 text-sm text-[#888]">Your account, AI assistants, and how the site works for you.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
          <SectionNav />
          <div className="flex min-w-0 flex-col gap-8">
        <Section
          id="account"
          description="Optional. Everything on this website works without an account; AI assistants need one to use EFT Toolset."
        >
          <AccountSection />
        </Section>

        <Section
          id="ai-assistants"
          description="Connect Claude, ChatGPT, Cursor and other assistants to every tool. They sign in with your EFT Toolset account."
        >
          <CopySnippet template="{endpoint}" label="server URL" />
          <Link href="/mcp" className={cn(linkClass, "inline-flex items-center gap-1.5 self-start")}>
            Setup for each assistant <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Section>

        <Section id="home-screen" description="Pick what the home page shows. Each one keeps the item search and links to every tool.">
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

        <Section id="game-mode" description="Switches every price and data set between PVP and PVE. The same switch is in the header.">
          <GameModeToggle />
        </Section>

        <Section
          id="data"
          description="Groups, builds, plans and these settings are saved only in this browser, not in your account. Back them up to move them to another device."
        >
          <Link href="/data" className={cn(linkClass, "self-start")}>
            Back up or restore
          </Link>
        </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
