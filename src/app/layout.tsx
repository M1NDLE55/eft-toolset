import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Github } from "lucide-react";
import { ReactNode } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { BulkCacheProvider } from "@/app/lib/cache/provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { GameModeProvider } from "@/components/game-mode/context";
import { Header } from "@/app/components/global/header";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://www.eft-toolset.com"),
  title: { default: "EFT Toolset", template: "%s | EFT Toolset" },
  description: "Become a Tarkov Chad with this awesome set of tools",
  openGraph: {
    title: "EFT Toolset",
    description: "Become a Tarkov Chad with this awesome set of tools",
    url: "https://www.eft-toolset.com/",
    siteName: "EFT Toolset",
    images: [
      {
        url: "https://www.eft-toolset.com/home-og-image.png",
        width: 1200,
        height: 630,
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EFT Toolset",
    description: "Become a Tarkov Chad with this awesome set of tools",
    images: ["/home-og-image.png"],
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce-based CSP requires per-request rendering so every framework script
  // receives the nonce created by proxy.ts.
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className}`}>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
          nonce={nonce}
        >
          <GameModeProvider>
            <Header />
            <BulkCacheProvider>
              {children}
            </BulkCacheProvider>
          </GameModeProvider>
          <footer className="border-t border-[#1a1a1a] p-4 min-h-16 flex justify-center items-center bg-[#070707]">
            <div className="w-full flex sm:flex-row sm:justify-between flex-col-reverse items-center gap-4">
              <div className="flex sm:flex-row flex-col-reverse items-center gap-4">
                <p className="text-[10px] uppercase tracking-widest text-[#888]">
                  &copy; {new Date().getFullYear().toString()} EFT Toolset
                </p>
                <p className="text-[10px] uppercase tracking-widest text-[#888]">
                  Maintained by{" "}
                  <a
                    href="https://github.com/M1NDLE55"
                    rel="noopener noreferrer"
                    className="text-[#9a8866] underline underline-offset-2"
                  >
                    M1NDLE55
                  </a>
                </p>
                <Link
                  href={{ pathname: "/policies/disclaimer-and-use-policy/" }}
                  className="text-[10px] uppercase tracking-widest text-[#888] underline underline-offset-2"
                >
                  Disclaimer and use policy
                </Link>
              </div>
              <a
                title="GitHub repository"
                href="https://github.com/M1NDLE55/eft-toolset"
                rel="noopener noreferrer"
                className="text-[#9a8866]"
              >
                <Github className="h-4 w-4" />
              </a>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
