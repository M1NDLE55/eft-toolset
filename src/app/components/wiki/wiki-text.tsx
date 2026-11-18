import { ExternalLink } from "lucide-react";
import type { WikiPageSection } from "@/app/lib/wiki/page-sections";
import { WIKI_LICENCE, WIKI_NAME } from "@/app/lib/wiki/wiki-url";
import { cn } from "@/lib/utils";

/** What the credit line needs of a wiki page read from the snapshot. */
export interface WikiPageCredit {
  title: string;
  url: string;
  snapshotDate: string;
}

/** Wiki text as written: "- " lines become a list and "| " lines table rows; everything else paragraphs. */
export function WikiText({ text }: { text: string }) {
  const blocks: { kind: "list" | "rows" | "text"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const kind = line.startsWith("- ") ? "list" : line.startsWith("|") ? "rows" : "text";
    const last = blocks.at(-1);
    if (last && last.kind === kind && kind !== "text") last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm text-[#bbb]">
      {blocks.map((block, index) => {
        if (block.kind === "list") {
          return (
            // Short entries, like spawn spots, flow into columns where the card is wide.
            <ul
              key={index}
              className={cn(
                "ml-4 list-disc space-y-0.5",
                block.lines.length > 4 && block.lines.every((line) => line.length < 40) && "columns-[11rem] gap-x-8"
              )}
            >
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "rows") {
          return (
            <ul key={index} className="divide-y divide-[#1a1a1a] border border-[#1a1a1a]">
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex} className="px-2 py-1 text-xs">
                  {line
                    .replace(/^\|\s*|\s*\|$/g, "")
                    .split(/\s*\|\s*/)
                    .filter(Boolean)
                    .join(" · ")}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block.lines[0]}</p>;
      })}
    </div>
  );
}

export function WikiSections({ sections }: { sections: WikiPageSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-[#ddd]">{section.heading}</h3>
          {section.text && <WikiText text={section.text} />}
          {section.subsections.map((subsection) => (
            <div key={subsection.heading} className="flex flex-col gap-1 border-l border-[#2a2a2a] pl-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#999]">{subsection.heading}</h4>
              <WikiText text={subsection.text} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The licence asks for credit and a link to the page with every use. */
export function WikiCredit({ wiki }: { wiki: WikiPageCredit }) {
  return (
    <p className="mt-3 border-t border-[#1a1a1a] pt-2 text-[11px] text-[#777]">
      From{" "}
      <a href={wiki.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#b9a473] hover:underline">
        {wiki.title} <ExternalLink aria-hidden className="h-2.5 w-2.5" />
      </a>{" "}
      on the {WIKI_NAME}, by its contributors,{" "}
      <a href={WIKI_LICENCE.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {WIKI_LICENCE.name}
      </a>
      ; adapted from the dump of {wiki.snapshotDate.slice(0, 10)}.
    </p>
  );
}
