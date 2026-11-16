"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import Accordion from "./accordion";
import { RomanLiteral } from "@/app/lib/roman";
import { itemHref } from "@/app/lib/item-links";
import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedHideoutRequirement,
  CachedHideoutSlot,
  CachedTask,
  CachedTaskObjective,
  CachedTaskUnlock,
} from "@/app/lib/cache/types";

const ITEM_COUNT_OBJECTIVES = new Set(["giveItem", "findItem", "plantItem", "sellItem", "mark"]);

/** "3×, found in raid" for objectives that take a number of the item. */
function objectiveCount(objective: CachedTaskObjective) {
  const { count } = objective;
  if (typeof count !== "number" || count <= 0 || !ITEM_COUNT_OBJECTIVES.has(objective.type ?? "")) return null;
  const parts = [objective.alternatives ? `${count}, any of ${objective.alternatives + 1} items` : `${count}×`];
  if (objective.foundInRaid) parts.push("found in raid");
  return parts.join(", ");
}

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

function List({ children }: { children: ReactNode }) {
  return <div className="-my-1">{children}</div>;
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
            href={itemHref(entry.item)}
            className={
              tone === "out"
                ? "text-emerald-400 underline-offset-2 hover:underline"
                : "text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline"
            }
          >
            {entry.item.name}
          </Link>
          {entry.tool && <span className="text-xs text-[#777]">(tool, kept)</span>}
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
    <List>
      {tasks.map((task, index) => (
        <Accordion
          key={`${task.name}-${index}`}
          isOpen={open.has(index)}
          onToggle={() => toggle(index)}
          title={
            <>
              <Badge>{task.trader.name}</Badge>
              {task.faction && <Badge>{task.faction}</Badge>}
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
              {task.objectives.map((objective, objectiveIndex) => {
                if (!objective.description) return null;
                const count = objectiveCount(objective);
                return (
                  <li key={objectiveIndex}>
                    {objective.description}
                    {count && <span className="ml-2 text-xs text-[#9a8866]">{count}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Accordion>
      ))}
    </List>
  );
}

export function HideoutUses({
  requirements,
  slots,
}: {
  requirements: CachedHideoutRequirement[];
  slots: CachedHideoutSlot[];
}) {
  const rows = [
    ...requirements.map((entry) => ({
      ...entry,
      text: `${entry.count}× for the upgrade${entry.foundInRaid ? ", found in raid" : ""}`,
    })),
    ...slots.map((entry) => ({
      ...entry,
      text: `Adds ${entry.slots} slot${entry.slots === 1 ? "" : "s"} to install it in`,
    })),
  ];
  return (
    <List>
      <ul>
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-2 border-b border-[#1a1a1a] py-2 text-sm last:border-b-0">
            <Badge>
              {row.station.name} {RomanLiteral(row.level) ?? row.level}
            </Badge>
            <span className="text-[#ccc]">{row.text}</span>
          </li>
        ))}
      </ul>
    </List>
  );
}

interface Recipe {
  source: string;
  level: number;
  taskUnlock: CachedTaskUnlock | null;
  requiredItems: CachedContainedItem[];
  rewardItems: CachedContainedItem[];
}

/** "2× Rechargeable battery + 1 more": what a recipe takes, for recipes that give the item. */
function inputsLabel(recipe: Recipe) {
  const [first, ...rest] = recipe.requiredItems.filter((entry) => !entry.tool);
  if (!first) return "Unknown inputs";
  return `${first.quantity}× ${first.item.name}${rest.length > 0 ? ` + ${rest.length} more` : ""}`;
}

function RecipeList({ recipes, label = "reward" }: { recipes: Recipe[]; label?: "reward" | "inputs" }) {
  const { open, toggle } = useOpenSet();
  return (
    <List>
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
                {label === "inputs" ? inputsLabel(recipe) : (recipe.rewardItems[0]?.item.name ?? "Unknown reward")}
              </span>
              {label === "reward" && (
                <span className="ml-auto shrink-0 text-xs text-[#777]">{recipe.requiredItems.length} in</span>
              )}
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
    </List>
  );
}

export function BartersUsing({ barters }: { barters: CachedBarter[] }) {
  return <RecipeList recipes={barters.map((barter) => ({ ...barter, source: barter.trader.name }))} />;
}

export function CraftsUsing({ crafts }: { crafts: CachedCraft[] }) {
  return <RecipeList recipes={crafts.map((craft) => ({ ...craft, source: craft.station.name }))} />;
}

/** Barters and crafts that give the item, labelled by what they take. */
export function WaysToGet({ barters, crafts }: { barters: CachedBarter[]; crafts: CachedCraft[] }) {
  return (
    <RecipeList
      label="inputs"
      recipes={[
        ...barters.map((barter) => ({ ...barter, source: barter.trader.name })),
        ...crafts.map((craft) => ({ ...craft, source: craft.station.name })),
      ]}
    />
  );
}
