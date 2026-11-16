"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Heart, Settings } from "lucide-react";
import { ItemSearch } from "@/app/components/global/search/item-search";
import { itemHref } from "@/app/lib/item-links";
import { useHydrated } from "@/app/lib/storage/use-store";
import { useScoutedItems } from "@/app/lib/scouted-items/store";
import { DEFAULT_HOME_LAYOUT, useHomeLayout, type HomeLayout } from "@/app/lib/settings/store";
import {
  BuildsPanel,
  GroupsPanel,
  MapsGrid,
  MarketBoardPanels,
  PlansPanel,
  RecentItemsPanel,
  ToolLinks,
} from "./panels";

const footLink =
  "flex items-center gap-2 text-xs uppercase tracking-widest text-[#888] underline-offset-4 hover:text-[#c8b384] hover:underline focus-visible:outline-2 focus-visible:outline-[#9a8866]";

function HomeSearch({ autoFocus = false, placeholder = "Search any item" }: { autoFocus?: boolean; placeholder?: string }) {
  const router = useRouter();
  return (
    <ItemSearch
      onSelect={(item) => router.push(itemHref(item))}
      onPrefetch={(item) => router.prefetch(itemHref(item))}
      placeholder={placeholder}
      autoFocus={autoFocus}
      shortcut
    />
  );
}

function RecentChips() {
  const hydrated = useHydrated();
  const items = useScoutedItems();
  if (!hydrated || items.length === 0) return null;
  return (
    <ul aria-label="Recently viewed items" className="flex flex-wrap items-center justify-center gap-2">
      <li className="text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">Recent</li>
      {items.slice(0, 6).map((item) => (
        <li key={item.name}>
          <Link
            href={itemHref(item)}
            className="flex max-w-48 items-center gap-2 border border-[#1f1f1f] bg-[#0c0c0c] py-1 pl-1 pr-2.5 text-xs text-[#aaa] transition-colors hover:border-[#9a8866] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
          >
            {item.gridImageLink ? (
              <Image src={item.gridImageLink} alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" />
            ) : (
              <span className="h-[22px] w-[22px] shrink-0 bg-[#151515]" />
            )}
            <span className="truncate">{item.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Dashboard() {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-3 pt-6">
      <HomeSearch />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <RecentItemsPanel limit={5} />
        <PlansPanel className="md:row-span-2" />
        <BuildsPanel />
        <GroupsPanel className="md:col-span-2" />
      </div>
    </div>
  );
}

function SearchFirst() {
  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-5 pt-8 sm:pt-12">
      <Image src="/black-logo.svg" alt="" height={110} width={300} priority className="h-auto w-full max-w-[300px] invert" />
      <p className="max-w-xl text-center text-sm text-[#999]">
        Fast, free tools for Escape from Tarkov. Live tarkov.dev data for PVP and PVE, saved locally, shareable by link.
      </p>
      <div className="w-full max-w-2xl">
        <HomeSearch autoFocus />
      </div>
      <RecentChips />
      <ToolLinks className="mt-4" />
    </div>
  );
}

function MarketBoard() {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-3 pt-6">
      <HomeSearch />
      <MarketBoardPanels />
      <GroupsPanel />
      <ToolLinks compact />
    </div>
  );
}

function MapsFirst() {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-3 pt-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Where are you dropping?</p>
          <p className="mt-1 text-sm text-[#888]">Open a map, or plan a route and share it with your squad.</p>
        </div>
        <div className="w-full md:max-w-sm">
          <HomeSearch placeholder="Search items" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <MapsGrid />
        <PlansPanel />
      </div>
      <ToolLinks compact />
    </div>
  );
}

const LAYOUTS: Record<HomeLayout, () => React.JSX.Element> = {
  bento: Dashboard,
  search: SearchFirst,
  market: MarketBoard,
  maps: MapsFirst,
};

/** children: server-rendered content shown under every layout. */
export function HomeScreen({ children }: { children?: React.ReactNode }) {
  const hydrated = useHydrated();
  const stored = useHomeLayout();
  const Layout = LAYOUTS[hydrated ? stored : DEFAULT_HOME_LAYOUT];

  return (
    <main className="flex flex-1 flex-col items-center px-4 pb-12">
      <h1 className="sr-only">EFT Toolset: Escape from Tarkov flea market prices, interactive maps and gun builder</h1>
      <Layout />
      {children}
      <div className="mt-8 flex flex-col items-center gap-3">
        <Link href="/mcp" className={footLink}>
          <Bot className="h-4 w-4 text-[#9a8866]" />
          Use every tool from Claude and other AI assistants
        </Link>
        <Link href="/credits" className={footLink}>
          <Heart className="h-4 w-4 text-[#9a8866]" />
          Check out the awesome tools powering EFT Toolset
        </Link>
        <Link href="/settings" className={footLink}>
          <Settings className="h-4 w-4 text-[#9a8866]" />
          Change this home screen
        </Link>
      </div>
    </main>
  );
}
