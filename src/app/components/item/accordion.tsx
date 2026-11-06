import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Accordion({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentId = useId();

  return (
    <div className="border-t border-[#1a1a1a] first:border-t-0">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#9a8866]"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">{title}</span>
        <ChevronDown
          aria-hidden
          className={cn("h-4 w-4 shrink-0 text-[#888] transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      <div
        id={contentId}
        role="region"
        inert={!isOpen}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="pb-3 text-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
