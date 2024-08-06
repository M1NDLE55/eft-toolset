import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Github } from "lucide-react";
import Image from "next/image";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "EFT Toolset",
  description: "Become a Tarkov Chad with this awesome set of tools",
  openGraph: {
    title: "EFT Toolset",
    description: "Become a Tarkov Chad with this awesome set of tools",
    url: "https://www.eft-toolset.com/",
    siteName: "EFT Toolset",
    images: [
      {
        url: "https://www.eft-toolset.com/home-og-image.png",
        height: 1200,
        width: 630,
      },
    ],
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-neutral-800`}>
        <header className="text-neutral-200 flex justify-center items-center border-b border-neutral-500 px-4 h-16">
          <div className="sm:w-full max-w-4xl">
            <Link href={{ pathname: "/" }} className="text-lg">
              <Image
                src="/eft-toolset-logo.png"
                alt="EFT Tools logo"
                width={150}
                height={55}
              />
            </Link>
          </div>
        </header>
        {children}
        <footer className="text-neutral-200 border-t border-neutral-500 p-4 min-h-16 flex justify-center items-center">
          <div className="w-full max-w-4xl flex sm:flex-row sm:justify-between flex-col items-center gap-4">
            <div className="flex sm:flex-row flex-col items-center gap-4">
              <p>&copy; {new Date().getFullYear().toString()} EFT Toolset</p>
              <p>
                Maintained by{" "}
                <a
                  href="https://github.com/M1NDLE55"
                  className="underline underline-offset-2"
                >
                  M1NDLE55
                </a>
              </p>
              <Link
                href={{ pathname: "/policies/disclaimer-and-use-policy/" }}
                className="underline underline-offset-2"
              >
                Disclaimer and use policy
              </Link>
            </div>
            <a
              title="GitHub repository"
              href="https://github.com/M1NDLE55/eft-toolset"
            >
              <Github />
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
