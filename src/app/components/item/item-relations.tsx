"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import Accordion from "./accordion";
import { RomanLiteral } from "@/app/lib/roman";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedTask,
  CachedTaskUnlock,
} from "@/app/lib/cache/types";

function useOpenSet() {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (index: number) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return { open, toggle };
}

function Section({
  id,
  title,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-2 scroll-mt-24">
      <h2 id={`${id}-title`} className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-widest text-[#9a8866]">
        {title}
        <span className="text-[#666]">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="border border-[#1a1a1a] bg-[#0c0c0c] px-3 py-3 text-sm text-[#888]">{empty}</p>
      ) : (
        <div className="border border-[#1a1a1a] bg-[#0c0c0c] px-3">{children}</div>
      )}
    </section>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 border border-[#3a3326] bg-[#1a1610] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8b384]">
      {children}
    </span>
  );
}

function WikiLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[#d4b86a] underline underline-offset-2 hover:underline-offset-4"
    >
      {children}
      <ExternalLink aria-hidden className="h-3 w-3" />
    </a>
  );
}

function ItemLines({ items, tone }: { items: CachedContainedItem[]; tone: "in" | "out" }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((entry, index) => (
        <li key={`${entry.item.name}-${index}`} className="flex gap-2">
          <span className="w-10 shrink-0 text-right tabular-nums text-[#888]">{entry.quantity}×</span>
          <Link
            href={`/item/${customEncodeURI(entry.item.name)}`}
            className={
              tone === "out"
                ? "text-emerald-400 underline-offset-2 hover:underline"
                : "text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline"
            }
          >
            {entry.item.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Unlock({ unlock }: { unlock: CachedTaskUnlock | null }) {
  if (!unlock) return null;
  return (
    <p className="mb-2 text-[#bbb]">
      Requires task:{" "}
      {unlock.wikiLink ? <WikiLink href={unlock.wikiLink}>{unlock.name}</WikiLink> : unlock.name}
    </p>
  );
}

export function UsedInTasks({ tasks }: { tasks: CachedTask[] }) {
  const { open, toggle } = useOpenSet();
  return (
    <Section id="tasks" title="Used in tasks" count={tasks.length} empty="Not needed for any task.">
      {tasks.map((task, index) => (
        <Accordion
          key={`${task.name}-${index}`}
          isOpen={open.has(index)}
          onToggle={() => toggle(index)}
          title={
            <>
              <Badge>{task.trader.name}</Badge>
              <span className={open.has(index) ? "min-w-0" : "min-w-0 truncate"}>{task.name}</span>
            </>
          }
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[#bbb]">
            <span>
              Level <span className="font-semibold text-[#e6d9b8]">{task.minPlayerLevel}</span>+
            </span>
            {task.wikiLink && <WikiLink href={task.wikiLink}>Wiki</WikiLink>}
          </div>
          {task.objectives.length > 0 && (
            <ul className="ml-5 list-disc space-y-1 text-[#ccc]">
              {task.objectives.map((objective, objectiveIndex) =>
                objective.description ? <li key={objectiveIndex}>{objective.description}</li> : null
              )}
            </ul>
          )}
        </Accordion>
      ))}
    </Section>
  );
}

function RecipeList({
  id,
  title,
  empty,
  recipes,
}: {
  id: string;
  title: string;
  empty: string;
  recipes: { source: string; level: number; taskUnlock: CachedTaskUnlock | null; requiredItems: CachedContainedItem[]; rewardItems: CachedContainedItem[] }[];
}) {
  const { open, toggle } = useOpenSet();
  return (
    <Section id={id} title={title} count={recipes.length} empty={empty}>
      {recipes.map((recipe, index) => (
        <Accordion
          key={`${recipe.source}-${recipe.rewardItems[0]?.item.name}-${index}`}
          isOpen={open.has(index)}
          onToggle={() => toggle(index)}
          title={
            <>
              <Badge>
                {recipe.source} {RomanLiteral(recipe.level) ?? recipe.level}
              </Badge>
              <span className={open.has(index) ? "min-w-0" : "min-w-0 truncate"}>
                {recipe.rewardItems[0]?.item.name ?? "Unknown reward"}
              </span>
              <span className="ml-auto shrink-0 text-xs text-[#777]">{recipe.requiredItems.length} in</span>
            </>
          }
        >
          <Unlock unlock={recipe.taskUnlock} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#777]">Requires</p>
              <ItemLines items={recipe.requiredItems} tone="in" />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#777]">Produces</p>
              <ItemLines items={recipe.rewardItems} tone="out" />
            </div>
          </div>
        </Accordion>
      ))}
    </Section>
  );
}

export function BartersUsing({ barters }: { barters: CachedBarter[] }) {
  return (
    <RecipeList
      id="barters"
      title="Barters using"
      empty="No barters use this item."
      recipes={barters.map((barter) => ({ ...barter, source: barter.trader.name }))}
    />
  );
}

export function CraftsUsing({ crafts }: { crafts: CachedCraft[] }) {
  return (
    <RecipeList
      id="crafts"
      title="Crafts using"
      empty="No crafts use this item."
      recipes={crafts.map((craft) => ({ ...craft, source: craft.station.name }))}
    />
  );
}
