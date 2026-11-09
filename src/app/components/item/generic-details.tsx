import Image from "next/image";
import { ExternalLink } from "lucide-react";
import Share from "./share";
import { Rubles } from "@/app/lib/currency";
import type { CachedVendorPrice, ComposedItem } from "@/app/lib/cache/types";
import { cn } from "@/lib/utils";
import { FLEA_MARKET, bestSell } from "@/app/lib/item-price";

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border border-[#1a1a1a] bg-[#0c0c0c] p-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">{label}</span>
      <span
        className={cn(
          "truncate text-lg font-semibold tabular-nums",
          tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-[#e6d9b8]"
        )}
      >
        {value}
      </span>
      {hint && <span className="truncate text-xs text-[#888]">{hint}</span>}
    </div>
  );
}

function PriceList({ title, offers, best }: { title: string; offers: CachedVendorPrice[]; best: CachedVendorPrice | undefined }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">{title}</h2>
      <ul className="flex-1 border border-[#1a1a1a] bg-[#0c0c0c] py-1">
        {offers.map((offer) => (
          <li
            key={offer.vendor.name}
            className={cn(
              "flex items-center justify-between gap-3 px-3 py-1.5 text-sm",
              offer === best ? "text-[#e6d9b8]" : "text-[#aaa]"
            )}
          >
            <span className="truncate">
              {offer.vendor.name}
              {offer === best && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#9a8866]">Best</span>}
            </span>
            <span className="shrink-0 tabular-nums">{Rubles.format(offer.priceRUB)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function GenericDetails({ item }: { item: ComposedItem }) {
  const sellFor = [...item.sellFor].sort((a, b) => b.priceRUB - a.priceRUB);
  const buyFor = [...item.buyFor].sort((a, b) => a.priceRUB - b.priceRUB);
  const flea = item.sellFor.find((offer) => offer.vendor.name === FLEA_MARKET);
  const best = bestSell(item);
  const slots = item.width * item.height;
  const change = item.changeLast48hPercent;

  return (
    <>
      <div className="flex gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
        {item.gridImageLink && (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center bg-[#111]">
            <Image src={item.gridImageLink} alt="" width={64 * item.width} height={64 * item.height} priority className="h-auto max-h-20 w-auto max-w-20 object-contain" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold leading-tight text-[#eee]">{item.name}</h1>
            <Share title={item.name} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#999]">
            {item.shortName && item.shortName !== item.name && (
              <span className="border border-[#2a2a2a] px-1.5 py-0.5 uppercase tracking-wider">{item.shortName}</span>
            )}
            <span className="border border-[#2a2a2a] px-1.5 py-0.5 tabular-nums">
              {item.width}×{item.height}
            </span>
            {item.wikiLink && (
              <a
                href={item.wikiLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#d4b86a] underline-offset-2 hover:underline"
              >
                Wiki <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Best sell"
          value={best ? Rubles.format(best.price) : "—"}
          hint={best ? (best?.flea ? "Flea, after fee" : best.vendor) : "Cannot be sold"}
        />
        <Stat
          label="Per slot"
          value={best ? Rubles.format(best.price / slots) : "—"}
          hint={`${slots} slot${slots === 1 ? "" : "s"}`}
        />
        <Stat
          label="Flea fee"
          value={item.fleaMarketFee !== null ? Rubles.format(item.fleaMarketFee) : "—"}
          hint={item.fleaMarketFee !== null ? (flea ? `Lists at ${Rubles.format(flea.priceRUB)}` : undefined) : "Not on flea"}
        />
        <Stat
          label="48h change"
          value={change !== null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
          tone={change === null || change === 0 ? undefined : change > 0 ? "good" : "bad"}
          hint="Flea average"
        />
      </div>

      {(buyFor.length > 0 || sellFor.length > 0) && (
        <div className={cn("grid grid-cols-1 gap-4", buyFor.length > 0 && sellFor.length > 0 && "sm:grid-cols-2")}>
          {buyFor.length > 0 && <PriceList title="Buy from" offers={buyFor} best={buyFor[0]} />}
          {sellFor.length > 0 && <PriceList title="Sell to" offers={sellFor} best={sellFor.find((offer) => offer.vendor.name === best?.vendor)} />}
        </div>
      )}
    </>
  );
}
