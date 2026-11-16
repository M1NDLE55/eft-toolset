import type { ReactNode } from "react";
import type { FaqEntry } from "@/app/lib/seo/item";

const heading = "text-xs font-bold uppercase tracking-widest text-[#9a8866]";

/** Indexable copy for a tool's landing page: what it does, its features, and common questions. */
export function ToolAbout({
  id,
  title,
  intro,
  features,
  faq,
  children,
}: {
  id: string;
  title: string;
  intro: ReactNode;
  features: { title: string; text: string }[];
  faq: FaqEntry[];
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6 border-t border-[#1a1a1a] pt-8">
      <div className="flex flex-col gap-2">
        <h2 id={id} className="text-lg font-black uppercase tracking-widest text-[#e6d9b8]">
          {title}
        </h2>
        <div className="max-w-3xl text-sm text-[#999]">{intro}</div>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {features.map((feature) => (
          <li key={feature.title} className="flex flex-col gap-1 border border-[#1a1a1a] bg-[#0c0c0c] p-3">
            <h3 className="text-sm font-semibold text-[#ddd]">{feature.title}</h3>
            <p className="text-sm text-[#888]">{feature.text}</p>
          </li>
        ))}
      </ul>
      {children}
      <div className="flex flex-col gap-2">
        <h2 className={heading}>Questions</h2>
        <dl className="flex flex-col divide-y divide-[#1a1a1a] border border-[#1a1a1a] bg-[#0c0c0c]">
          {faq.map((entry) => (
            <div key={entry.question} className="flex flex-col gap-1 px-3 py-2.5">
              <dt className="text-sm font-semibold text-[#ddd]">{entry.question}</dt>
              <dd className="text-sm text-[#999]">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
