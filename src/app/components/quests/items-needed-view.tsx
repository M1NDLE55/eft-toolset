"use client";

import Image from "next/image";
import Link from "next/link";
import { itemHref } from "@/app/lib/item-links";
import type { QuestGraph } from "@/app/lib/quests/graph";
import { questName } from "@/app/lib/quests/display";
import type { ShoppingList, ShoppingRow } from "@/app/lib/quests/shopping-list";
import { CURRENCY_ITEMS, moneyLabel } from "@/app/lib/quests/shopping-list";
import type { QuestItem, QuestList } from "@/app/lib/quests/types";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { Badge, empty, heading, panel, textLink } from "./quest-bits";

const MAX_CHOICE_ITEMS = 8;

export function ItemLink({ item, className }: { item: QuestItem | undefined; className?: string }) {
  if (!item) return <span className={className}>Unknown item</span>;
  return (
    <Link href={itemHref({ name: item.name, normalizedName: item.slug })} className={className ?? textLink} title={item.name}>
      {item.name}
    </Link>
  );
}

export function ItemImage({ item }: { item: QuestItem | undefined }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#111]">
      {item?.image && <Image src={item.image} alt="" width={32} height={32} className="max-h-8 w-auto" />}
    </span>
  );
}

function QuestLinks({ quests, graph }: { quests: { id: string; count: number }[]; graph: QuestGraph }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[#777]">
      {quests.map((entry) => {
        const quest = graph.byId.get(entry.id);
        if (!quest) return null;
        const label = `${questName(quest)}${entry.count > 1 ? ` ×${entry.count.toLocaleString("en-US")}` : ""}`;
        return quest.slug ? (
          <Link key={entry.id} href={`/quests/${quest.slug}`} className="underline-offset-2 hover:text-[#c8b384] hover:underline">
            {label}
          </Link>
        ) : (
          <span key={entry.id}>{label}</span>
        );
      })}
    </span>
  );
}

function Rows({ title, hint, rows, list, graph }: { title: string; hint: string; rows: ShoppingRow[]; list: QuestList; graph: QuestGraph }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section className="flex flex-col gap-2">
      <h3 className={heading}>
        {title} <span className="text-[#666]">· {rows.length} items, {total.toLocaleString("en-US")} in all</span>
      </h3>
      <p className="-mt-1 text-xs text-[#777]">{hint}</p>
      {rows.length === 0 ? (
        <p className={empty}>Nothing here for the quests shown.</p>
      ) : (
        <ul className={`${panel} divide-y divide-[#151515]`}>
          {rows.map((row) => {
            const item = list.items[row.id];
            return (
              <li key={row.id} className="flex items-start gap-3 px-3 py-2 hover:bg-[#100f0c]">
                <ItemImage item={item} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <ItemLink item={item} className={`${textLink} text-sm`} />
                  <QuestLinks quests={row.quests} graph={graph} />
                </div>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-[#e6d9b8]">×{row.count.toLocaleString("en-US")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Keeps the rows whose item's name or short name matches the search. */
export function matchingRows(rows: ShoppingRow[], items: QuestList["items"], text: string) {
  const query = normalizeText(text);
  if (!query) return rows;
  return rows.filter((row) => {
    const item = items[row.id];
    return Boolean(item && (normalizeText(item.name).includes(query) || (item.shortName && normalizeText(item.shortName).includes(query))));
  });
}

export function ItemsNeededView({
  shopping,
  list,
  graph,
  text,
  questCount,
}: {
  shopping: ShoppingList;
  list: QuestList;
  graph: QuestGraph;
  text: string;
  questCount: number;
}) {
  const choices = shopping.choices.filter((choice) => {
    const query = normalizeText(text);
    if (!query) return true;
    return choice.need.items.some((id) => normalizeText(list.items[id]?.name ?? "").includes(query));
  });
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-[#888]">
        For {questCount.toLocaleString("en-US")} quests. Mark an objective done on a quest&apos;s page to take its items off this list. Both
        sides of a choice you haven&apos;t made yet are counted, until you complete one.
      </p>
      {shopping.money.length > 0 && !text && (
        <section className="flex flex-col gap-2">
          <h3 className={heading}>Money to hand over</h3>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {shopping.money.map((row) => (
              <div key={row.id} className={`${panel} flex flex-col gap-1 p-3`}>
                <dt className="text-[10px] font-bold uppercase tracking-widest text-[#777]">{CURRENCY_ITEMS[row.id]}</dt>
                <dd className="text-lg font-semibold tabular-nums text-[#e6d9b8]">{moneyLabel(row.id, row.count)}</dd>
                <dd>
                  <QuestLinks quests={row.quests} graph={graph} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <Rows
        title="Found in raid"
        hint="Keep these with their found-in-raid mark: bought items won't count."
        rows={matchingRows(shopping.foundInRaid, list.items, text)}
        list={list}
        graph={graph}
      />
      <Rows
        title="Bought or found"
        hint="Any copy will do: buy, barter, craft or loot them."
        rows={matchingRows(shopping.other, list.items, text)}
        list={list}
        graph={graph}
      />
      {choices.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className={heading}>
            Any one of <span className="text-[#666]">· {choices.length}</span>
          </h3>
          <p className="-mt-1 text-xs text-[#777]">Each of these takes one kind of item from a choice, so they aren&apos;t added to the lists above.</p>
          <ul className={`${panel} divide-y divide-[#151515]`}>
            {choices.map((choice) => {
              const quest = graph.byId.get(choice.quest);
              const shown = choice.need.items.slice(0, MAX_CHOICE_ITEMS);
              const more = Math.max(choice.need.alternatives ?? choice.need.items.length, choice.need.items.length) - shown.length;
              return (
                <li key={`${choice.quest}-${choice.need.objectives[0]}`} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[#e6d9b8]">×{choice.need.count}</span>
                    {choice.need.foundInRaid && <Badge>FIR</Badge>}
                    {quest?.slug ? (
                      <Link href={`/quests/${quest.slug}`} className={`${textLink} text-sm`}>
                        {questName(quest)}
                      </Link>
                    ) : (
                      <span className="text-sm text-[#ccc]">{quest ? questName(quest) : "Quest"}</span>
                    )}
                  </div>
                  {choice.need.label && <p className="text-xs text-[#999]">{choice.need.label}</p>}
                  {shown.length > 0 && (
                    <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[#888]">
                      Any of:
                      {shown.map((id) => (
                        <ItemLink key={id} item={list.items[id]} className="text-[#aaa] underline-offset-2 hover:text-[#e6d9b8] hover:underline" />
                      ))}
                      {more > 0 && <span>and {more} more</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
