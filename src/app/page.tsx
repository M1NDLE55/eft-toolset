import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { Bot, ChevronRight, Crosshair, Heart, Layers, Map as MapIcon, ScanSearch } from "lucide-react";
import { appLinks } from "@/app/lib/links";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { JsonLd } from "@/app/components/seo/json-ld";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME } from "@/app/lib/seo/site-copy";
import { SITE_ORIGIN } from "@/app/lib/site";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    type: "website",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION, images: ["/home-og-image.png"] },
};

const icons = {
  "/item": ScanSearch,
  "/item-groups": Layers,
  "/gun-builder": Crosshair,
  "/raid-planner": MapIcon,
} as const;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      name: SITE_NAME,
      alternateName: ["EFT-Toolset", "eft-toolset.com"],
      url: `${SITE_ORIGIN}/`,
      description: HOME_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_ORIGIN}/#organization`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/black-logo.svg`,
      sameAs: ["https://github.com/M1NDLE55/eft-toolset"],
    },
  ],
};

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pb-12">
      <JsonLd data={structuredData} />
      <h1 className="sr-only">EFT Toolset: Escape from Tarkov flea market prices, interactive maps and gun builder</h1>
      <Image
        src="/black-logo.svg"
        alt=""
        height={184}
        width={500}
        priority
        className="my-8 h-auto w-full max-w-[420px] invert sm:my-12"
      />
      <p className="mb-8 max-w-xl text-center text-sm text-[#999]">
        Fast, free tools for Escape from Tarkov: live flea market prices, interactive maps and a gun builder. Live
        tarkov.dev data for PVP and PVE, saved locally, shareable by link.
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
                  {link.title}
                </span>
                <span className="text-sm text-[#888]">{link.description}</span>
              </span>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#9a8866] transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </nav>
      <nav aria-labelledby="home-maps" className="mt-8 flex w-full max-w-3xl flex-col gap-3">
        <h2 id="home-maps" className="text-[10px] font-bold uppercase tracking-widest text-[#777]">
          Interactive Tarkov maps
        </h2>
        <ul className="flex flex-wrap gap-2">
          {mapConfigs.map((map) => (
            <li key={map.key}>
              <Link
                href={`/raid-planner/map/${map.key}`}
                className="inline-block border border-[#1a1a1a] bg-[#0c0c0c] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
              >
                {map.name} map
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Link
        href="/mcp"
        className="mt-8 flex items-center gap-2 text-xs uppercase tracking-widest text-[#888] underline-offset-4 hover:text-[#c8b384] hover:underline focus-visible:outline-2 focus-visible:outline-[#9a8866]"
      >
        <Bot className="h-4 w-4 text-[#9a8866]" />
        Use every tool from Claude and other AI assistants
      </Link>
      <Link
        href="/credits"
        className="mt-3 flex items-center gap-2 text-xs uppercase tracking-widest text-[#888] underline-offset-4 hover:text-[#c8b384] hover:underline focus-visible:outline-2 focus-visible:outline-[#9a8866]"
      >
        <Heart className="h-4 w-4 text-[#9a8866]" />
        Check out the awesome tools powering EFT Toolset
      </Link>
    </main>
  );
}
