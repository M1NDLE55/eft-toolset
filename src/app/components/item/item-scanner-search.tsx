"use client";

import { usePathname, useRouter } from "next/navigation";
import { ItemSearch } from "@/app/components/global/search/item-search";
import { itemHref } from "@/app/lib/item-links";

export function ItemScannerSearch() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <ItemSearch
      onSelect={(item) => router.push(itemHref(item))}
      onPrefetch={(item) => router.prefetch(itemHref(item))}
      autoFocus={pathname === "/item"}
      shortcut
    />
  );
}
