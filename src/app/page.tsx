import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Crosshair, Layers, Map as MapIcon, ScanSearch } from "lucide-react";
import { appLinks } from "@/app/lib/links";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const icons = {
  "/item": ScanSearch,
  "/item-groups": Layers,
  "/gun-builder": Crosshair,
  "/raid-planner": MapIcon,
} as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pb-12">
      <h1 className="sr-only">EFT Toolset</h1>
      <Image
        src="/black-logo.svg"
        alt=""
        height={184}
        width={500}
        priority
        className="my-8 h-auto w-full max-w-[420px] invert sm:my-12"
      />
      <p className="mb-8 max-w-xl text-center text-sm text-[#999]">
        Fast, free tools for Escape from Tarkov. Live tarkov.dev data for PVP and PVE, saved locally, shareable by link.
      </p>
      <nav aria-label="Tools" className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        {appLinks.map((link) => {
          const Icon = icons[link.href as keyof typeof icons];
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-start gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-4 transition-colors hover:border-[#9a8866] hover:bg-[#100f0c] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#2a2a2a] text-[#9a8866] transition-colors group-hover:border-[#9a8866]">
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-widest text-[#ddd] group-hover:text-[#e6d9b8]">
                  {link.text}
                </span>
                <span className="text-sm text-[#888]">{link.description}</span>
              </span>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#9a8866] transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </nav>
    </main>
  );
}
