"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Menu, Settings } from "lucide-react";
import { navLinks } from "@/app/lib/links";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GameModeToggle } from "@/components/game-mode/toggle";
import { STALE_UPSTREAM_EVENT, isUpstreamStale } from "@/app/lib/api/transport";

function subscribeStale(listener: () => void) {
  window.addEventListener(STALE_UPSTREAM_EVENT, listener);
  return () => window.removeEventListener(STALE_UPSTREAM_EVENT, listener);
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const staleUpstream = useSyncExternalStore(subscribeStale, isUpstreamStale, () => false);

  return (
    <header className="w-full border-b border-[#1a1a1a] bg-[#070707]">
      <div className="flex h-16 w-full items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center" aria-label="EFT Toolset home">
            <Image src="/black-logo.svg" alt="" height={37} width={100} priority className="invert" />
          </Link>
          <nav aria-label="Tools" className="hidden items-center md:flex">
            {navLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative px-3 py-5 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-[#9a8866]",
                    active ? "text-[#c8b384]" : "text-[#888] hover:text-[#ccc]"
                  )}
                >
                  {link.text}
                  {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 bg-[#9a8866]" />}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {staleUpstream && (
            <span
              role="status"
              title="Tarkov.dev is unavailable; showing the most recent cached data."
              className="hidden text-[10px] uppercase tracking-widest text-amber-300 sm:inline"
            >
              Cached data
            </span>
          )}
          <GameModeToggle />
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            aria-current={isActive(pathname, "/settings") ? "page" : undefined}
            className={cn(
              "hidden h-10 w-10 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-[#9a8866] md:flex",
              isActive(pathname, "/settings") ? "text-[#c8b384]" : "text-[#888] hover:text-[#ccc]"
            )}
          >
            <Settings className="h-4 w-4" aria-hidden />
          </Link>
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {navLinks.map((link) => (
                  <DropdownMenuItem key={link.href} asChild className="py-3">
                    <Link
                      href={link.href}
                      aria-current={isActive(pathname, link.href) ? "page" : undefined}
                      className={cn(isActive(pathname, link.href) && "text-[#c8b384]")}
                    >
                      {link.text}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem asChild className="py-3">
                  <Link
                    href="/settings"
                    aria-current={isActive(pathname, "/settings") ? "page" : undefined}
                    className={cn(isActive(pathname, "/settings") && "text-[#c8b384]")}
                  >
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
