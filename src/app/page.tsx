import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { appLinks } from '@/app/lib/links';

export default function Home() {
  return (
    <main className="flex flex-col items-center px-4 pb-4 sm:min-h-[calc(100vh-130px)] min-h-[calc(100vh-65px)]">
      <Image
        src="/black-logo.svg"
        alt="EFT Toolset Logo"
        height={274}
        width={627}
        className="dark:invert"
      />
      <div className="max-w-xl flex flex-col gap-3 w-full">
        {appLinks.map((link) => (
          <Link
            key={link.text}
            href={{ pathname: link.href }}
            className="border border-[#1a1a1a] bg-[#0c0c0c] hover:border-[#9a8866] hover:bg-[#111] transition-colors flex flex-row justify-between items-center px-4 py-3 group"
          >
            <span className="text-xs uppercase tracking-widest text-[#ccc] group-hover:text-[#9a8866] transition-colors font-bold">
              {link.text}
            </span>
            <ChevronRight className="h-4 w-4 text-[#9a8866]" />
          </Link>
        ))}
      </div>
    </main>
  );
}
