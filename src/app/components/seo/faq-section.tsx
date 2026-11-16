import type { FaqEntry } from "@/app/lib/seo/item";

/** Visible questions under a tool, matching the page's FAQ structured data. */
export function FaqSection({ id, title, entries }: { id: string; title: string; entries: FaqEntry[] }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
        {title}
      </h2>
      <dl className="flex flex-col divide-y divide-[#1a1a1a] border border-[#1a1a1a] bg-[#0c0c0c]">
        {entries.map((entry) => (
          <div key={entry.question} className="flex flex-col gap-1 px-3 py-2.5">
            <dt className="text-sm font-semibold text-[#ddd]">{entry.question}</dt>
            <dd className="text-sm text-[#999]">{entry.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
