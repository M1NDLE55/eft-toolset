import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { preconnect } from "react-dom";
import { connection } from "next/server";
import { headers } from "next/headers";
import { GameModeProvider } from "@/components/game-mode/context";
import { CloudflareAnalytics } from "@/app/components/global/cloudflare-analytics";
import { Header } from "@/app/components/global/header";

const inter = Inter({ subsets: ["latin"], display: "swap" });

const description = "Become a Tarkov Chad with this awesome set of tools";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.eft-toolset.com"),
  title: { default: "EFT Toolset", template: "%s | EFT Toolset" },
  description,
  applicationName: "EFT Toolset",
  openGraph: {
    title: "EFT Toolset",
    description,
    url: "https://www.eft-toolset.com/",
    siteName: "EFT Toolset",
    images: [{ url: "https://www.eft-toolset.com/home-og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EFT Toolset",
    description,
    images: ["/home-og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#070707",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  preconnect("https://assets.tarkov.dev");

  return (
    <html lang="en" className={inter.className}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#content"
          className="sr-only z-50 bg-[#9a8866] px-3 py-2 text-xs font-bold uppercase tracking-widest text-black focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
        >
          Skip to content
        </a>
        <GameModeProvider>
          <Header />
          <div id="content" className="flex flex-1 flex-col">
            {children}
          </div>
        </GameModeProvider>
        <footer className="border-t border-[#1a1a1a] bg-[#070707] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex w-full flex-col-reverse items-center gap-4 text-[10px] uppercase tracking-widest text-[#888] sm:flex-row sm:justify-between">
            <div className="flex flex-col-reverse items-center gap-3 sm:flex-row sm:gap-5">
              <p>&copy; {new Date().getFullYear()} EFT Toolset</p>
              <p>
                Maintained by{" "}
                <a href="https://github.com/M1NDLE55" rel="noopener noreferrer" className="text-[#9a8866] underline underline-offset-2">
                  M1NDLE55
                </a>
              </p>
              <Link href="/policies/disclaimer-and-use-policy" className="underline underline-offset-2 hover:text-[#ccc]">
                Disclaimer and use policy
              </Link>
              <p>
                Data from{" "}
                <a href="https://tarkov.dev" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#ccc]">
                  tarkov.dev
                </a>
              </p>
            </div>
            <a
              title="GitHub repository"
              aria-label="GitHub repository"
              href="https://github.com/M1NDLE55/eft-toolset"
              rel="noopener noreferrer"
              className="flex h-10 w-10 items-center justify-center text-[#9a8866] hover:text-[#e6d9b8]"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
                <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
              </svg>
            </a>
          </div>
        </footer>
        <CloudflareAnalytics nonce={nonce} />
      </body>
    </html>
  );
}
