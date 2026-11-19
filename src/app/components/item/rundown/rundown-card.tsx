import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { ComposedItem } from "@/app/lib/cache/types";
import { Rubles } from "@/app/lib/currency";
import { summarizeNeeds, taskUses, type QuestIdentity, type TaskNeed } from "@/app/lib/item-needs";
import { FLEA_MARKET, LOOT_ONLY, bestBuy, bestSell, fleaBuyBasis, sellSourceLabel } from "@/app/lib/item-price";

/** How many quests, upgrades or maps to list before "+N more". */
export const SHOWN = 3;

const label = "text-[10px] font-bold uppercase tracking-widest text-[#9a8866]";

export function RundownImage({ item }: { item: Pick<ComposedItem, "gridImageLink"> | null }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-[#111]">
      {item?.gridImageLink && <Image src={item.gridImageLink} alt="" width={48} height={48} className="h-auto max-h-12 w-auto max-w-12 object-contain" />}
    </span>
  );
}

function Price({ title, value, source, note }: { title: string; value: string; source: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border border-[#1a1a1a] bg-[#0e0e0e] px-2.5 py-2">
      <span className={label}>{title}</span>
      <span className="truncate text-base font-semibold tabular-nums text-[#e6d9b8]">{value}</span>
      <span className="truncate text-xs text-[#888]">{source}</span>
      {note}
    </div>
  );
}

function Prices({ item }: { item: ComposedItem }) {
  const buy = bestBuy(item);
  const sell = bestSell(item);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Price
        title="Best buy"
        value={buy ? Rubles.format(buy.priceRUB) : "—"}
        source={
          buy ? (
            <>
              {buy.vendor.name}
              {buy.minTraderLevel ? ` LL${buy.minTraderLevel}` : ""}
              {buy.vendor.name === FLEA_MARKET && <span className="text-[#666]"> · {fleaBuyBasis(item)}</span>}
            </>
          ) : item.fleaBanned ? (
            <span className="whitespace-normal">{LOOT_ONLY}</span>
          ) : (
            "Not sold"
          )
        }
        note={
          <>
            {buy?.preset && (
              <span className="truncate text-[11px] text-[#777]" title={buy.preset}>
                As the default preset
              </span>
            )}
            {buy?.taskUnlock && (
              <span className="flex items-center gap-1 truncate text-[11px] text-amber-300/80">
                <Lock aria-hidden className="h-3 w-3 shrink-0" />
                After {buy.taskUnlock.name}
              </span>
            )}
          </>
        }
      />
      <Price title="Best sell" value={sell ? Rubles.format(sell.price) : "—"} source={sell ? sellSourceLabel(sell) : "Cannot be sold"} />
    </div>
  );
}

function Count({ need }: { need: TaskNeed }) {
  if (need.count === 0) return <span className="text-[#777]">uses it</span>;
  return (
    <span className="tabular-nums text-[#e6d9b8]">
      ×{need.count.toLocaleString("en-US")}
      {need.foundInRaid > 0 && (
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-[#c8b384]">
          {need.foundInRaid === need.count ? "FIR" : `${need.foundInRaid} FIR`}
        </span>
      )}
    </span>
  );
}

function Rows({ rows, more }: { rows: { key: string; name: ReactNode; value: ReactNode }[]; more: number }) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {rows.map((row) => (
        <li key={row.key} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[#bbb]">{row.name}</span>
          <span className="shrink-0 text-xs">{row.value}</span>
        </li>
      ))}
      {more > 0 && <li className="text-xs text-[#777]">+{more} more</li>}
    </ul>
  );
}

function Needs({ item, quest }: { item: ComposedItem; quest: QuestIdentity | null }) {
  const { current, others } = taskUses(item, quest);
  const needs = summarizeNeeds(item);
  const upgrades = item.hideoutRequirements;
  return (
    <section aria-label="Where it's needed" className="flex flex-col gap-2">
      {current && (
        <div className="flex items-baseline justify-between gap-3 border border-[#3a3326] bg-[#1a1610] px-2.5 py-1.5 text-sm">
          <span className="text-[#ddd]">This quest</span>
          <span className="text-xs">
            <Count need={current.need} />
          </span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={label}>{current ? "Also needed for" : "Needed for"}</h3>
        {/* Totals take in every use, so beside "Also needed for" they would read as the other uses' count. */}
        {!current && needs && needs.total > 0 && (
          <span className="text-xs tabular-nums text-[#888]">
            {needs.total.toLocaleString("en-US")} in all{needs.foundInRaid > 0 ? `, ${needs.foundInRaid} FIR` : ""}
          </span>
        )}
      </div>
      {others.length === 0 && upgrades.length === 0 ? (
        <p className="text-sm text-[#888]">{current ? "Nothing else." : "No quest or hideout upgrade needs it."}</p>
      ) : (
        <>
          {others.length > 0 && (
            <Rows
              rows={others.slice(0, SHOWN).map(({ task, need }, index) => ({
                key: `${task.name}-${index}`,
                name: (
                  <>
                    {task.name}
                    <span className="ml-1.5 text-xs text-[#666]">
                      {task.trader.name}
                      {task.faction ? ` · ${task.faction}` : ""}
                    </span>
                  </>
                ),
                value: <Count need={need} />,
              }))}
              more={others.length - SHOWN}
            />
          )}
          {upgrades.length > 0 && (
            <Rows
              rows={upgrades.slice(0, SHOWN).map((entry, index) => ({
                key: `${entry.station.name}-${entry.level}-${index}`,
                name: (
                  <>
                    {entry.station.name} <span className="text-xs text-[#666]">level {entry.level}</span>
                  </>
                ),
                value: <Count need={{ count: entry.count, foundInRaid: entry.foundInRaid ? entry.count : 0 }} />,
              }))}
              more={upgrades.length - SHOWN}
            />
          )}
        </>
      )}
    </section>
  );
}

function KeyInfo({ info }: { info: NonNullable<ComposedItem["key"]> }) {
  return (
    <section aria-label="What it opens" className="flex flex-col gap-1.5">
      <h3 className={label}>Opens</h3>
      {info.opens && <p className="text-sm leading-snug text-[#bbb]">{info.opens}</p>}
      {info.maps.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {info.maps.map((map) => (
            <li key={map.key}>
              <Link
                href={`/keys/${map.key}`}
                className="inline-block border border-[#2a2a2a] px-2 py-1 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
              >
                {map.name} keys
                <span className="ml-1 text-[#666]">
                  · {map.locks} lock{map.locks === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Prices, what needs it, and for keys what it opens: the item page's essentials, worked out the same way. */
export function ItemRundownBody({ item, quest }: { item: ComposedItem; quest: QuestIdentity | null }) {
  return (
    <>
      <Prices item={item} />
      {item.key && <KeyInfo info={item.key} />}
      <Needs item={item} quest={quest} />
    </>
  );
}
