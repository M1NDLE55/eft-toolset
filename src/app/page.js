import Image from "next/image";
import Link from "next/link";
import { ChevronRightCircle } from "lucide-react";

export default async function Home() {
  const links = [{ text: "Item scanner", href: "/item-scanner" }];

  return (
    <main className="flex flex-col items-center px-4 pb-4 sm:min-h-[calc(100vh-128px)] min-h-[calc(100vh-64px)]">
      <Image src="/eft-logo.png" alt="EFT Logo" height={274} width={627} />
      <div className="max-w-xl flex flex-col gap-4 text-white w-full">
        {links.map((link) => (
          <Link
            key={link.text}
            href={{ pathname: link.href }}
            className="rounded-md hover:shadow-neutral-500 transition-all shadow-md bg-neutral-700 p-3 text-xl flex flex-row justify-between items-center"
          >
            <p>{link.text}</p>
            <ChevronRightCircle />
          </Link>
        ))}
      </div>
    </main>
  );
}
