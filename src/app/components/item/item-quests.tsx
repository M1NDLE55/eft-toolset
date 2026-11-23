import type { ReactNode } from "react";
import Link from "@/app/lib/navigation/link";
import { Badge, heading } from "@/app/components/quests/quest-bits";
import { levelLabel } from "@/app/lib/quests/display";
import type { ItemQuestAnyOf, ItemQuestKey, ItemQuestNeed, ItemQuests } from "@/app/lib/quests/item-quests";
import type { QuestSummary } from "@/app/lib/quests/types";

/** Rows shown before the rest fold into "Show more"; the folded ones stay in the page. */
const SHOWN = 12;

const count = (value: number) => value.toLocaleString("en-US");

function QuestSection({ id, title, total, children }: { id: string; title: string; total: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className={heading}>
          {title}
        </h2>
        <span className="text-3xs uppercase tracking-widest text-[#666]">
          {total} {total === 1 ? "quest" : "quests"}
        </span>
      </div>
      {children}
    </section>
  );
}

function Rows<T>({ rows, render }: { rows: T[]; render: (row: T) => ReactNode }) {
  const list = "grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3";
  const rest = rows.slice(SHOWN);
  return (
    <>
      <ul className={list}>{rows.slice(0, SHOWN).map(render)}</ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-2xs font-bold uppercase tracking-widest text-[#c8b384]">
            Show {rest.length} more
          </summary>
          <ul className={`${list} mt-2`}>{rest.map(render)}</ul>
        </details>
      )}
    </>
  );
}

function QuestTitle({ quest, name, hint }: { quest: QuestSummary; name: string; hint: string | null }) {
  const level = levelLabel(quest.minPlayerLevel);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <Link href={`/quests/${quest.slug}`} className="text-sm text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
        {name}
      </Link>
      <span className="text-2xs text-[#777]">
        {[quest.trader, level ?? "Any level", hint].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

function FirBadge({ foundInRaid, total }: { foundInRaid: number; total: number }) {
  if (foundInRaid === 0) return null;
  const all = foundInRaid === total;
  return (
    <Badge title={all ? "Must be found in raid" : `${count(foundInRaid)} of them must be found in raid`}>
      {all ? "FIR" : `${count(foundInRaid)} FIR`}
    </Badge>
  );
}

function AnyOfLine({ need }: { need: ItemQuestAnyOf }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-2xs text-[#888]">
      <span className="font-semibold tabular-nums text-[#c8b384]">×{count(need.count)}</span>
      {need.foundInRaid && <Badge title="Must be found in raid">FIR</Badge>}
      <span>
        any of {count(need.accepted)} accepted items{need.label ? `: ${need.label}` : ""}
      </span>
    </span>
  );
}

function NeedRow(row: ItemQuestNeed) {
  return (
    <li key={row.quest.id} className="flex flex-col gap-1.5 border border-[#1a1a1a] bg-[#0c0c0c] px-3 py-2">
      <span className="flex items-start justify-between gap-3">
        <QuestTitle quest={row.quest} name={row.name} hint={row.hint} />
        {row.count > 0 && (
          <span className="flex shrink-0 items-center gap-1.5">
            <FirBadge foundInRaid={row.foundInRaid} total={row.count} />
            <span className="font-semibold tabular-nums text-[#e6d9b8]">×{count(row.count)}</span>
          </span>
        )}
      </span>
      {row.anyOf.map((need, index) => (
        <AnyOfLine key={index} need={need} />
      ))}
    </li>
  );
}

function KeyRow(row: ItemQuestKey) {
  return (
    <li key={row.quest.id} className="flex items-start justify-between gap-3 border border-[#1a1a1a] bg-[#0c0c0c] px-3 py-2">
      <QuestTitle quest={row.quest} name={row.name} hint={row.hint} />
      {row.maps.length > 0 && <span className="shrink-0 text-right text-2xs text-[#888]">{row.maps.join(", ")}</span>}
    </li>
  );
}

/**
 * The quests that need an item and the quests that use it as a key, with links to their pages. The server page
 * renders it, so it's in the page whatever cards the visitor's layout shows.
 */
export function ItemQuestLinks({ quests }: { quests: ItemQuests }) {
  if (quests.needed.length === 0 && quests.keys.length === 0) return null;
  return (
    <div className="flex flex-col gap-6 pt-2">
      {quests.needed.length > 0 && (
        <QuestSection id="item-needed-for-quests" title="Needed for quests" total={quests.needed.length}>
          <Rows rows={quests.needed} render={NeedRow} />
        </QuestSection>
      )}
      {quests.keys.length > 0 && (
        <QuestSection id="item-used-in-quests" title="Used in quests" total={quests.keys.length}>
          <Rows rows={quests.keys} render={KeyRow} />
        </QuestSection>
      )}
    </div>
  );
}
