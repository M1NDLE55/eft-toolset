import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { ReactNode } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { BulkCacheProvider } from "@/app/lib/cache/provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { GameModeProvider } from "@/components/game-mode/context";
import { CloudflareAnalytics } from "@/app/components/global/cloudflare-analytics";
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
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
                  <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
                </svg>
              </a>
            </div>
          </footer>
        </ThemeProvider>
        <CloudflareAnalytics nonce={nonce} />
      </body>
    </html>
  );
}
