import { ReactNode, useId, useRef } from "react";
import { ChevronDown } from "lucide-react";

export default function Accordion({
  title,
  isOpen,
  setOpenIndex,
  className,
  children,
}: {
  title: ReactNode;
  isOpen: boolean;
  setOpenIndex: VoidFunction;
  className: string | boolean;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement | null>(null);
  const contentId = useId();

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      <button
        type="button"
        className="flex w-full flex-row justify-between py-2 text-left"
        onClick={setOpenIndex}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <span className={`flex min-w-0 ${!isOpen ? "items-center truncate" : "flex-wrap items-baseline"}`}>{title}</span>
        <ChevronDown
          className="shrink-0 transition-rotate ease-in-out duration-500"
          style={isOpen ? { rotate: "180deg" } : { rotate: "0deg" }}
        />
      </button>
      <div
        id={contentId}
        ref={content}
        aria-hidden={!isOpen}
        className="transition-height ease-in-out duration-500"
        style={
          isOpen
            ? { height: content.current?.scrollHeight ?? "auto", marginBottom: "12px", visibility: "visible" }
            : { height: "0px", visibility: "hidden" }
        }
      >
        {children}
      </div>
    </div>
  );
}
