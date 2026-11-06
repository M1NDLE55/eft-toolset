import type { Metadata } from "next";
import { RecentItems } from "@/app/components/item/scouted-items";

export const metadata: Metadata = {
  title: "Item database",
  description: "Find Escape from Tarkov item prices, trader offers, tasks, barters, and crafts.",
  alternates: { canonical: "/item" },
};

export default function Page() {
  return (
    <>
      <div className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
        <h1 className="text-sm font-bold uppercase tracking-widest text-[#c8b384]">Item scanner</h1>
        <p className="text-sm text-[#999]">
          Look up any item for trader and flea prices, slot value, and every task, barter, and craft that needs it.
          Press <kbd className="border border-[#2a2a2a] px-1 text-[11px]">/</kbd> anywhere to search.
        </p>
      </div>
      <RecentItems />
    </>
  );
}
