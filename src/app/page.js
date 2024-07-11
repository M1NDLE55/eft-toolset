import Image from "next/image";
import Link from "next/link";
import { ChevronRightCircle } from "lucide-react";

export default async function Home() {
  const links = [
    { text: "Scanner", href: "/scanner" },
    // { text: "Profit Calculator", href: "/profit" },
  ];

  return (
    <main className="h-screen flex flex-col items-center px-4 pb-4">
      <Image src="/eft-logo.png" alt="EFT Logo" height={274} width={627} />
      <div className="max-w-xl flex flex-col text-white w-full">
        {links.map((link, i) => (
          <Link
            key={link.text}
            href={{ pathname: link.href }}
            className={`${
              i === 0 ? "border-t" : ""
            } border-b p-4 text-xl flex flex-row justify-between items-center`}
          >
            <p>{link.text}</p>
            <ChevronRightCircle />
          </Link>
        ))}
      </div>
    </main>
  );
}
