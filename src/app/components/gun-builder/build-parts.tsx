import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { DescribedBuild } from "@/app/lib/builds/best-builds";
import { Rubles } from "@/app/lib/currency";

const heading = "text-xs font-bold uppercase tracking-widest text-[#9a8866]";

function sourceLabel(part: DescribedBuild["parts"][number]) {
  if (part.withWeapon) return "With the preset";
  if (part.source === "flea") return "Flea";
  if (part.source === "trader") return part.traderName ?? "Trader";
  if (part.source === "barter") return "Barter";
  return "Not for sale";
}

/** A build's parts, each with its slot, price and where to buy it, and a link to open it. */
export function BuildPartsSection({
  id,
  title,
  build,
  linkLabel = "Open in gun builder",
}: {
  id: string;
  title: string;
  build: DescribedBuild;
  linkLabel?: string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id={id} className={heading}>
          {title}
        </h2>
        <a
          href={build.shareHref}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#c8b384] underline-offset-2 hover:underline"
        >
          {linkLabel} <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      </div>
      <table className="w-full table-fixed border border-[#1a1a1a] bg-[#0c0c0c] text-sm">
        <colgroup>
          <col />
          <col className="w-28 sm:w-36" />
        </colgroup>
        <thead className="text-left text-[10px] uppercase tracking-widest text-[#666]">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-bold">Slot and part</th>
            <th scope="col" className="px-3 py-1.5 text-right font-bold">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#151515]">
          {build.parts.map((part, index) => (
            <tr key={`${part.slot}-${index}`}>
              <td className="break-words px-3 py-1.5">
                <span className="block text-[10px] uppercase tracking-wider text-[#777]">{part.slot}</span>
                {part.slug ? (
                  <Link href={`/item/${part.slug}`} className="text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                    {part.name}
                  </Link>
                ) : (
                  <span className="text-[#ccc]">{part.name}</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right">
                <span className="block tabular-nums text-[#ddd]">
                  {part.withWeapon || part.priceRUB === null ? "—" : Rubles.format(part.priceRUB)}
                </span>
                <span className="block truncate text-[10px] text-[#777]">{sourceLabel(part)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
