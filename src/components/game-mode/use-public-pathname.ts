"use client";

// The one place usePathname is allowed (see eslint.config.mjs).
// eslint-disable-next-line no-restricted-imports
import { usePathname } from "@/app/lib/navigation/hooks";
import { publicPathname } from "@/app/lib/game-mode-routes";

/**
 * usePathname without the PVE copies' internal prefix, so a PVE copy renders the same on the
 * server, where Vercel renders it at /pve/…, as in the browser, which shows the public URL.
 */
export function usePublicPathname(): string | null {
  const pathname = usePathname();
  return pathname === null ? null : publicPathname(pathname);
}
