"use client";

import { useRouter } from "next/navigation";
import { usePublicPathname } from "@/components/game-mode/use-public-pathname";
import { ItemSearch } from "@/app/components/global/search/item-search";
import { itemHref } from "@/app/lib/item-links";

export function ItemScannerSearch() {
  const router = useRouter();
  const pathname = usePublicPathname();

  return (
    <ItemSearch
      onSelect={(item) => router.push(itemHref(item))}
      onPrefetch={(item) => router.prefetch(itemHref(item))}
      autoFocus={pathname === "/item"}
      shortcut
    />
  );
}
