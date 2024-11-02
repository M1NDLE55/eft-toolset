import { ReactNode, useRef } from "react";
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

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      <div
        className="flex flex-row justify-between py-2 cursor-pointer"
        onClick={setOpenIndex}
      >
        <p className={`${!isOpen ? "truncate" : ""}`}>{title}</p>
        <ChevronDown
          className="shrink-0 transition-rotate ease-in-out duration-500"
          style={isOpen ? { rotate: "180deg" } : { rotate: "0deg" }}
        />
      </div>
      <div
        ref={content}
        className="transition-height ease-in-out duration-500"
        style={
          isOpen
            ? { height: content.current!.scrollHeight, marginBottom: "12px" }
            : { height: "0px" }
        }
      >
        {children}
      </div>
    </div>
  );
}
