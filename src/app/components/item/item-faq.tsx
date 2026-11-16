import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { FaqEntry } from "@/app/lib/seo/item";
import { ITEM_HUB_NAME } from "@/app/lib/seo/site-copy";

export function ItemBreadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="-mb-2 text-[11px] uppercase tracking-widest text-[#777]">
      <ol className="flex min-w-0 items-center gap-1">
        <li className="shrink-0">
          <Link href="/item" className="hover:text-[#c8b384] hover:underline underline-offset-2">
            {ITEM_HUB_NAME}
          </Link>
        </li>
        <li aria-hidden className="shrink-0">
          <ChevronRight className="h-3 w-3" />
        </li>
        <li aria-current="page" className="truncate text-[#999]">
          {name}
        </li>
      </ol>
    </nav>
  );
}

export function ItemFaq({ name, entries }: { name: string; entries: FaqEntry[] }) {
  return (
    <section aria-labelledby="item-faq" className="flex flex-col gap-2">
      <h2 id="item-faq" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
        {name}: price questions
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
