"use client";

import Link from "next/link";
import type { QuestStatus } from "@/app/lib/quests/availability";
import { levelLabel, questName } from "@/app/lib/quests/display";
import type { QuestList, QuestSummary } from "@/app/lib/quests/types";
import { CompleteToggle, QuestBadges, StatePill, heading, lockedReason, panel } from "./quest-bits";

export function mapNames(quest: QuestSummary, list: Pick<QuestList, "maps">) {
  return Array.from(new Set(quest.maps.map((key) => list.maps[key]?.name ?? key)));
}

function QuestRow({
  quest,
  list,
  status,
  onToggle,
  disabled,
  nameOf,
}: {
  quest: QuestSummary;
  list: QuestList;
  status: QuestStatus | undefined;
  onToggle: (quest: QuestSummary) => void;
  disabled: boolean;
  nameOf: (id: string) => string;
}) {
  const name = questName(quest);
  const meta = [
    levelLabel(quest.minPlayerLevel),
    ...quest.traderLevels.map((entry) => `${entry.trader} LL${entry.level}`),
    mapNames(quest, list).join(", ") || null,
  ].filter(Boolean);
  const reason = status?.state === "locked" ? lockedReason(status, nameOf) : "";
  return (
    <li className="flex items-center gap-3 px-2 py-2 sm:px-3">
      <CompleteToggle name={name} completed={status?.state === "completed"} disabled={disabled} onToggle={() => onToggle(quest)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {quest.slug ? (
            <Link href={`/quests/${quest.slug}`} className="min-w-0 text-sm font-semibold text-[#ddd] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
              {name}
            </Link>
          ) : (
            <span className="min-w-0 text-sm font-semibold text-[#ddd]">{name}</span>
          )}
          <QuestBadges quest={quest} />
        </div>
        {meta.length > 0 && <p className="mt-0.5 text-xs text-[#777]">{meta.join(" · ")}</p>}
        {reason && <p className="mt-0.5 line-clamp-2 text-[11px] text-[#666]">Needs: {reason}</p>}
      </div>
      {status && <StatePill state={status.state} />}
    </li>
  );
}

/** Quests grouped under their trader, in the list's order, each with its complete toggle and status. */
export function QuestRows({
  quests,
  list,
  statuses,
  onToggle,
  disabled,
  nameOf,
}: {
  quests: QuestSummary[];
  list: QuestList;
  statuses: ReadonlyMap<string, QuestStatus> | null;
  onToggle: (quest: QuestSummary) => void;
  disabled: boolean;
  nameOf: (id: string) => string;
}) {
  const groups = new Map<string, QuestSummary[]>();
  for (const quest of quests) {
    const trader = quest.trader ?? "Other";
    const group = groups.get(trader);
    if (group) group.push(quest);
    else groups.set(trader, [quest]);
  }
  return (
    <div className="flex flex-col gap-5">
      {Array.from(groups, ([trader, entries]) => (
        <section key={trader} aria-label={`${trader} quests`} className="flex flex-col gap-2">
          <h3 className={heading}>
            {trader} <span className="text-[#666]">· {entries.length}</span>
          </h3>
          <ul className={`${panel} divide-y divide-[#151515]`}>
            {entries.map((quest) => (
              <QuestRow key={quest.id} quest={quest} list={list} status={statuses?.get(quest.id)} onToggle={onToggle} disabled={disabled} nameOf={nameOf} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
