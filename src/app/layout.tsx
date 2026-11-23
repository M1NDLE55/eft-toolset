import { Inter } from "next/font/google";
import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { preconnect } from "react-dom";
import { GameModeProvider } from "@/components/game-mode/context";
import { ItemRundownProvider } from "@/app/components/item/rundown/rundown-link";
import { CloudflareAnalytics } from "@/app/components/global/cloudflare-analytics";
import { Header } from "@/app/components/global/header";
import { SiteFooter } from "@/app/components/global/site-footer";
import { ServiceWorker } from "@/app/components/global/service-worker";
import { ContentScaleSync } from "@/app/components/global/content-scale";
import { contentScaleScript } from "@/app/lib/settings/content-scale";
import { SITE_ORIGIN } from "@/app/lib/site";
import { HOME_DESCRIPTION, SITE_NAME } from "@/app/lib/seo/site-copy";

const inter = Inter({ subsets: ["latin"], display: "swap" });

const description = HOME_DESCRIPTION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description,
  applicationName: "EFT Toolset",
  openGraph: {
    title: "EFT Toolset",
    description,
    url: `${SITE_ORIGIN}/`,
    siteName: "EFT Toolset",
    images: [{ url: `${SITE_ORIGIN}/home-og-image.png`, width: 1200, height: 630 }],
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

// Pages are cached and served to everyone, so nothing here reads the request: no per-request CSP
// nonce (see src/app/lib/security/headers.ts) and no cookies.
export default function RootLayout({ children }: { children: ReactNode }) {
  preconnect("https://assets.tarkov.dev");

  return (
    // The inline script sets the saved content size on <html> before hydration.
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: contentScaleScript() }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#content"
          className="unscaled sr-only z-50 bg-[#9a8866] px-3 py-2 text-xs font-bold uppercase tracking-widest text-black focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
        >
          Skip to content
        </a>
        <GameModeProvider>
          <Header />
          <div id="content" className="flex flex-1 flex-col">
            <ItemRundownProvider>{children}</ItemRundownProvider>
          </div>
        </GameModeProvider>
        <SiteFooter />
        <ServiceWorker />
        <ContentScaleSync />
        <CloudflareAnalytics />
      </body>
    </html>
  );
}
