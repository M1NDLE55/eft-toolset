"use client";

// The one place usePathname is allowed (see eslint.config.mjs).
// eslint-disable-next-line no-restricted-imports
import { usePathname } from "@/app/lib/navigation/hooks";
import { publicPathname } from "@/app/lib/game-mode-routes";

/** The current path as the visitor sees it (without the old /pve prefix, which only redirects now). */
export function usePublicPathname(): string | null {
  const pathname = usePathname();
  return pathname === null ? null : publicPathname(pathname);
}
