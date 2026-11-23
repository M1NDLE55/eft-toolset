import Link from "@/app/lib/navigation/link";
import { ChevronRight } from "lucide-react";
import { ITEM_HUB_NAME } from "@/app/lib/seo/site-copy";

export function ItemBreadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-2xs uppercase tracking-widest text-[#777]">
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
