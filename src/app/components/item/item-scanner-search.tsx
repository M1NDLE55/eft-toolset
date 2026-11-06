"use client";

import { usePathname, useRouter } from "next/navigation";
import { ItemSearch } from "@/app/components/global/search/item-search";
import { customEncodeURI } from "@/app/lib/URIEncoding";

export function ItemScannerSearch() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <ItemSearch
      onSelect={(item) => router.push(`/item/${customEncodeURI(item.name)}`)}
      autoFocus={pathname === "/item"}
      shortcut
      prefetch
    />
  );
}
