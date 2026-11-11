import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { taskHint, type ShownPrice } from "./format";

/** The label under a price: who charges it, with a lock when a task comes first. */
export function PriceSource({ shown, className, lockClassName = "h-3 w-3" }: { shown: ShownPrice; className?: string; lockClassName?: string }) {
  const { source, traderNote } = shown;
  if (!source) return null;
  const hint = [taskHint(source.task), traderNote].filter(Boolean).join(". ") || undefined;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-[#9a8866]", className)} title={hint}>
      <span className="truncate">{source.label}</span>
      {source.task && <Lock aria-label={taskHint(source.task)} className={cn("shrink-0", lockClassName)} />}
    </span>
  );
}
