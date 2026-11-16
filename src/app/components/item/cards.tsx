import type { ReactNode } from "react";
import { ExternalLink, Lock } from "lucide-react";
import { Rubles } from "@/app/lib/currency";
import type { CachedVendorPrice, ComposedItem } from "@/app/lib/cache/types";
import { FLEA_MARKET, bestSell, fleaPrices } from "@/app/lib/item-price";
import type { ItemNeeds } from "@/app/lib/item-needs";
import type { PricePoint } from "@/app/lib/price-history";
import type { ItemWiki, ItemWikiSection } from "@/app/lib/wiki/item-wiki";
import { WIKI_LICENCE, WIKI_NAME } from "@/app/lib/wiki/wiki-url";
import type { ItemCardId } from "@/app/lib/item-views/views";
import { cn } from "@/lib/utils";
import { BartersUsing, CraftsUsing, HideoutUses, UsedInTasks, WaysToGet } from "./item-relations";
import { PriceTrend, trendSeries } from "./price-trend";

export interface CardContext {
  item: ComposedItem;
  wiki: ItemWiki | null;
  needs: ItemNeeds | null;
  /** Prices recorded on this device, and the live price to end the line at; empty until hydrated. */
  history: readonly PricePoint[];
  livePrice: number | null;
  now: number;
}

export interface CardDefinition {
  render: (context: CardContext) => ReactNode;
  /** True when the card has nothing for this item; empty cards are hidden outside editing. */
  empty?: (context: CardContext) => boolean;
  /** Shown in place of an empty card while editing. */
  emptyText?: string;
  count?: (context: CardContext) => number;
  /** A single figure: drawn compactly, and two to a row on phones. */
  stat?: boolean;
}

function StatValue({ value, hint, tone }: { value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
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

function PriceList({ offers, best, fleaNote }: { offers: CachedVendorPrice[]; best: CachedVendorPrice | undefined; fleaNote?: string }) {
  return (
    <ul className="-mx-3 -my-1">
      {offers.map((offer, index) => (
        <li
          // A trader can sell an item at several levels, or as a preset.
          key={`${offer.vendor.name}-${index}`}
          className={cn(
            "flex items-center justify-between gap-3 px-3 py-1.5 text-sm",
            offer === best ? "text-[#e6d9b8]" : "text-[#aaa]"
          )}
        >
          <span className="min-w-0">
            <span className="block truncate">
              {offer.vendor.name}
              {offer.minTraderLevel && <span className="ml-1.5 text-xs text-[#777]">LL{offer.minTraderLevel}</span>}
              {fleaNote && offer.vendor.name === FLEA_MARKET && <span className="ml-2 text-xs text-[#777]">{fleaNote}</span>}
              {offer === best && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#9a8866]">Best</span>}
            </span>
            {offer.preset && (
              <span className="block truncate text-xs text-[#777]" title={offer.preset}>
                As the default preset
              </span>
            )}
            {offer.taskUnlock && (
              <span className="flex items-center gap-1 truncate text-xs text-amber-300/80">
                <Lock aria-hidden className="h-3 w-3 shrink-0" />
                After {offer.taskUnlock.name}
              </span>
            )}
          </span>
          <span className="shrink-0 tabular-nums">{Rubles.format(offer.priceRUB)}</span>
        </li>
      ))}
    </ul>
  );
}

function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[#888]">{label}</dt>
          <dd className="min-w-0 text-right tabular-nums text-[#ccc]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const sellOffers = (item: ComposedItem) => [...item.sellFor].sort((a, b) => b.priceRUB - a.priceRUB);
const buyOffers = (item: ComposedItem) => [...item.buyFor].sort((a, b) => a.priceRUB - b.priceRUB);
const recipeCount = (item: ComposedItem) => (item.bartersGiving?.length ?? 0) + (item.craftsGiving?.length ?? 0);

/** Wiki text as written: "- " lines become a list and "| " lines table rows; everything else paragraphs. */
function WikiText({ text }: { text: string }) {
  const blocks: { kind: "list" | "rows" | "text"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const kind = line.startsWith("- ") ? "list" : line.startsWith("|") ? "rows" : "text";
    const last = blocks.at(-1);
    if (last && last.kind === kind && kind !== "text") last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm text-[#bbb]">
      {blocks.map((block, index) => {
        if (block.kind === "list") {
          return (
            // Short entries, like spawn spots, flow into columns where the card is wide.
            <ul
              key={index}
              className={cn(
                "ml-4 list-disc space-y-0.5",
                block.lines.length > 4 && block.lines.every((line) => line.length < 40) && "columns-[11rem] gap-x-8"
              )}
            >
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "rows") {
          return (
            <ul key={index} className="divide-y divide-[#1a1a1a] border border-[#1a1a1a]">
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex} className="px-2 py-1 text-xs">
                  {line
                    .replace(/^\|\s*|\s*\|$/g, "")
                    .split(/\s*\|\s*/)
                    .filter(Boolean)
                    .join(" · ")}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block.lines[0]}</p>;
      })}
    </div>
  );
}

function WikiSections({ sections }: { sections: ItemWikiSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-[#ddd]">{section.heading}</h3>
          {section.text && <WikiText text={section.text} />}
          {section.subsections.map((subsection) => (
            <div key={subsection.heading} className="flex flex-col gap-1 border-l border-[#2a2a2a] pl-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#999]">{subsection.heading}</h4>
              <WikiText text={subsection.text} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The licence asks for credit and a link to the page with every use. */
function WikiCredit({ wiki }: { wiki: ItemWiki }) {
  return (
    <p className="mt-3 border-t border-[#1a1a1a] pt-2 text-[11px] text-[#777]">
      From{" "}
      <a href={wiki.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#b9a473] hover:underline">
        {wiki.title} <ExternalLink aria-hidden className="h-2.5 w-2.5" />
      </a>{" "}
      on the {WIKI_NAME}, by its contributors,{" "}
      <a href={WIKI_LICENCE.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {WIKI_LICENCE.name}
      </a>
      ; adapted from the dump of {wiki.snapshotDate.slice(0, 10)}.
    </p>
  );
}

function NeedsBody({ needs }: { needs: ItemNeeds | null }) {
  if (!needs) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-emerald-400">Safe to sell</p>
        <p className="text-xs text-[#888]">No task or hideout upgrade needs it.</p>
      </div>
    );
  }
  const rows: [string, string][] = [];
  if (needs.forTasks > 0) rows.push(["Tasks", `${needs.forTasks} for ${plural(needs.taskCount, "task")}`]);
  if (needs.forHideout > 0) rows.push(["Hideout", `${needs.forHideout} for ${plural(needs.upgradeCount, "upgrade")}`]);
  if (needs.hideoutSlots > 0) rows.push(["Installed", `Up to ${needs.hideoutSlots} in the hideout`]);
  if (needs.otherTaskCount > 0) rows.push(["Also", `${plural(needs.otherTaskCount, "task")} use it or take other items`]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-lg font-semibold text-[#e6d9b8]">
          {needs.total > 0 ? `Keep ${needs.total}` : needs.hideoutSlots > 0 ? "Keep for the hideout" : "Check its tasks"}
        </p>
        {needs.foundInRaid > 0 && (
          <span className="border border-[#3a3326] bg-[#1a1610] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8b384]">
            {needs.foundInRaid} found in raid
          </span>
        )}
      </div>
      <Facts rows={rows} />
    </div>
  );
}

export const CARD_DEFINITIONS: Record<ItemCardId, CardDefinition> = {
  "best-sell": {
    stat: true,
    render: ({ item }) => {
      const best = bestSell(item);
      return (
        <StatValue
          value={best ? Rubles.format(best.price) : "—"}
          hint={best ? (best.flea ? "Flea, after fee" : best.vendor) : "Cannot be sold"}
        />
      );
    },
  },
  "per-slot": {
    stat: true,
    render: ({ item }) => {
      const best = bestSell(item);
      const slots = item.width * item.height;
      return (
        <StatValue
          value={best && !item.weapon ? Rubles.format(best.price / slots) : "—"}
          hint={item.weapon ? "Depends on attachments" : plural(slots, "slot")}
        />
      );
    },
  },
  "flea-fee": {
    stat: true,
    render: ({ item }) => {
      const flea = item.sellFor.find((offer) => offer.vendor.name === FLEA_MARKET);
      return (
        <StatValue
          value={item.fleaMarketFee !== null ? Rubles.format(item.fleaMarketFee) : "—"}
          hint={
            item.fleaBanned
              ? "Banned from flea"
              : item.fleaMarketFee !== null
                ? flea
                  ? `Lists at ${Rubles.format(flea.priceRUB)}`
                  : undefined
                : "Not on flea"
          }
        />
      );
    },
  },
  "change-48h": {
    stat: true,
    render: ({ item }) => {
      const change = item.changeLast48hPercent;
      return (
        <StatValue
          value={change !== null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
          tone={change === null || change === 0 ? undefined : change > 0 ? "good" : "bad"}
          hint="Flea average"
        />
      );
    },
  },
  "sell-to": {
    empty: ({ item }) => item.sellFor.length === 0,
    render: ({ item }) => {
      const best = bestSell(item);
      return (
        <PriceList
          offers={sellOffers(item)}
          best={item.sellFor.find((offer) => offer.vendor.name === best?.vendor)}
          fleaNote="lowest listing"
        />
      );
    },
  },
  "buy-from": {
    empty: ({ item }) => item.buyFor.length === 0,
    render: ({ item }) => {
      const offers = buyOffers(item);
      return (
        <PriceList offers={offers} best={offers[0]} fleaNote={fleaPrices(item)?.avg24h != null ? "24h avg" : "lowest listing"} />
      );
    },
  },
  "price-history": {
    emptyText: "Appears once you've seen this item's price on two visits.",
    empty: ({ history, livePrice, now }) => livePrice === null || trendSeries(history, livePrice, now).length < 2,
    render: ({ history, livePrice, now }) =>
      livePrice !== null ? <PriceTrend points={history} price={livePrice} now={now} /> : null,
  },
  "flea-market": {
    empty: ({ item }) => !item.info && item.fleaMarketFee === null && !item.fleaBanned,
    render: ({ item }) => {
      const info = item.info;
      const rows: [string, ReactNode][] = [];
      if (item.fleaBanned) rows.push(["Flea market", "Banned"]);
      if (info?.lastLowPrice != null && !item.fleaBanned) rows.push(["Lowest listing", Rubles.format(info.lastLowPrice)]);
      if (info?.avg24hPrice) rows.push(["24h average", Rubles.format(info.avg24hPrice)]);
      if (info?.low24hPrice && info.high24hPrice) {
        rows.push(["24h range", `${Rubles.format(info.low24hPrice)} – ${Rubles.format(info.high24hPrice)}`]);
      }
      if (info?.lastOfferCount != null && !item.fleaBanned) rows.push(["Listings", info.lastOfferCount.toLocaleString("en-US")]);
      if (item.fleaMinLevel) rows.push(["Flea level", `Level ${item.fleaMinLevel}`]);
      if (info?.basePrice) rows.push(["Base price", Rubles.format(info.basePrice)]);
      return rows.length > 0 ? <Facts rows={rows} /> : <p className="text-sm text-[#888]">No flea market data.</p>;
    },
  },
  needs: {
    render: ({ needs }) => <NeedsBody needs={needs} />,
  },
  about: {
    render: ({ item }) => {
      const info = item.info;
      const rows: [string, ReactNode][] = [];
      if (info?.categories.length) rows.push(["Category", info.categories.slice(0, 2).join(" · ")]);
      if (info?.weight != null) rows.push(["Weight", `${info.weight.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg`]);
      rows.push(["Size", `${item.width}×${item.height}${item.weapon ? " stripped" : ""}`]);
      if (info?.stackMaxSize && info.stackMaxSize > 1) rows.push(["Stacks to", info.stackMaxSize.toLocaleString("en-US")]);
      return (
        <div className="flex flex-col gap-3">
          {info?.description && <p className="text-sm leading-relaxed text-[#bbb]">{info.description}</p>}
          <Facts rows={rows} />
        </div>
      );
    },
  },
  tasks: {
    emptyText: "No task needs this item.",
    empty: ({ item }) => item.usedInTasks.length === 0,
    count: ({ item }) => item.usedInTasks.length,
    render: ({ item }) => <UsedInTasks tasks={item.usedInTasks} />,
  },
  hideout: {
    emptyText: "No hideout upgrade needs this item.",
    empty: ({ item }) => item.hideoutRequirements.length + item.hideoutSlots.length === 0,
    count: ({ item }) => item.hideoutRequirements.length + item.hideoutSlots.length,
    render: ({ item }) => <HideoutUses requirements={item.hideoutRequirements} slots={item.hideoutSlots} />,
  },
  "barters-using": {
    emptyText: "No barter takes this item.",
    empty: ({ item }) => item.bartersUsing.length === 0,
    count: ({ item }) => item.bartersUsing.length,
    render: ({ item }) => <BartersUsing barters={item.bartersUsing} />,
  },
  "crafts-using": {
    emptyText: "No craft takes this item.",
    empty: ({ item }) => item.craftsUsing.length === 0,
    count: ({ item }) => item.craftsUsing.length,
    render: ({ item }) => <CraftsUsing crafts={item.craftsUsing} />,
  },
  obtain: {
    emptyText: "No barter or craft gives this item.",
    empty: ({ item }) => recipeCount(item) === 0,
    count: ({ item }) => recipeCount(item),
    render: ({ item }) => <WaysToGet barters={item.bartersGiving ?? []} crafts={item.craftsGiving ?? []} />,
  },
  "wiki-where": {
    emptyText: "The wiki doesn't say where to find this item.",
    empty: ({ wiki }) => !wiki || wiki.whereToFind.length === 0,
    render: ({ wiki }) =>
      wiki && (
        <>
          <WikiSections sections={wiki.whereToFind} />
          <WikiCredit wiki={wiki} />
        </>
      ),
  },
  "wiki-notes": {
    emptyText: "No wiki notes for this item.",
    empty: ({ wiki }) => !wiki || (wiki.notes.length === 0 && wiki.facts.length === 0),
    render: ({ wiki }) =>
      wiki && (
        <>
          <div className="flex flex-col gap-3">
            {wiki.facts.length > 0 && <Facts rows={wiki.facts.map((fact) => [fact.label, fact.value])} />}
            <WikiSections sections={wiki.notes} />
          </div>
          <WikiCredit wiki={wiki} />
        </>
      ),
  },
};
