'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Menu } from 'lucide-react';
import { appLinks } from '@/app/lib/links';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GameModeToggle } from '@/components/game-mode/toggle';
import { useEffect, useState } from 'react';

export function Header() {
  const [staleUpstream, setStaleUpstream] = useState(false);

  useEffect(() => {
    const update = (event: Event) =>
      setStaleUpstream(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('eft-toolset:stale-upstream', update);
    return () => window.removeEventListener('eft-toolset:stale-upstream', update);
  }, []);

  return (
    <header className="border-b border-[#1a1a1a] w-full bg-[#070707]">
      <div className="h-16 px-4 flex items-center justify-between w-full">
        <div className="flex items-center gap-3">
          <Link href={{ pathname: '/' }} className="flex items-center gap-2 uppercase tracking-widest">
            <Image
              src="/black-logo.svg"
              alt="EFT Toolset Logo"
              height={50}
              width={100}
              className="dark:invert"
            />
            <span className="sr-only">EFT Toolset</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {appLinks.map((link) => (
              <Button key={link.text} variant="ghost" asChild>
                <Link href={{ pathname: link.href }}>{link.text}</Link>
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {staleUpstream && (
            <span role="status" title="The live data service is unavailable; cached data is being used." className="text-[10px] uppercase tracking-widest text-amber-300">
              Cached data
            </span>
          )}
          <GameModeToggle />
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <Menu className="h-[1.2rem] w-[1.2rem]" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {appLinks.map((link) => (
                  <DropdownMenuItem key={link.text} asChild>
                    <Link href={{ pathname: link.href }}>{link.text}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
