import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { JsonLd, breadcrumbList } from "@/app/components/seo/json-ld";
import { requireForRender } from "@/app/lib/api/server-render";
import { getKeyCounts } from "@/app/lib/reference/keys";

const TITLE = "Tarkov Keys by Map: Every Key, Price & Quest Use";
const DESCRIPTION =
  "Every Escape from Tarkov key and keycard by map: which locks it opens, what it costs on the flea market and from traders, what it sells for, and the tasks that need it.";

// Key counts per map change with patches.
export const revalidate = 86400;
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/keys" },
  openGraph: { title: `${TITLE} | EFT Toolset`, description: DESCRIPTION, url: "/keys", images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
};

export default async function Page() {
  const counts = await requireForRender("Keys list", () => getKeyCounts("regular"));
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <JsonLd data={breadcrumbList([{ name: "EFT Toolset", path: "/" }, { name: "Keys by map", path: "/keys" }])} />
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Tarkov keys by map</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          Every key and keycard that opens a lock on each map, with its flea market and trader price, what it sells for,
          and the tasks that need it. Pick a map to see its keys, or open the{" "}
          <Link href="/item" className="text-[#c8b384] underline underline-offset-2">
            item prices
          </Link>{" "}
          page for the most valuable keys overall.
        </p>
      </header>
      {counts.length === 0 ? (
        <p className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">
          Key data is temporarily unavailable. Try again in a moment.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {counts.map((map) => (
            <li key={map.key}>
              <Link
                href={`/keys/${map.key}`}
                className="group flex items-center gap-3 border border-[#1a1a1a] bg-[#0c0c0c] p-3 transition-colors hover:border-[#9a8866]"
              >
                <KeyRound aria-hidden className="h-4 w-4 shrink-0 text-[#9a8866]" />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-[#ddd] group-hover:text-[#e6d9b8]">{map.name} keys</span>
                  <span className="text-xs text-[#777]">{map.keys} keys</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
