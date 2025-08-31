import Image from 'next/image';
import Link from 'next/link';
import { ChevronRightCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { appLinks } from '@/app/lib/links';

export default function Home() {
  return (
    <main className="flex flex-col items-center px-4 pb-4 sm:min-h-[calc(100vh-128px)] min-h-[calc(100vh-64px)]">
      <Image
        src="/black-logo.svg"
        alt="EFT Toolset Logo"
        height={274}
        width={627}
        className="dark:invert invert-0"
      />
      <div className="max-w-xl flex flex-col gap-3 w-full">
        {appLinks.map((link) => (
          <Button key={link.text} variant={'secondary'} asChild>
            <Link
              href={{ pathname: link.href }}
              className="flex flex-row justify-between items-center"
            >
              <p>{link.text}</p>
              <ChevronRightCircle />
            </Link>
          </Button>
        ))}
      </div>
    </main>
  );
}
