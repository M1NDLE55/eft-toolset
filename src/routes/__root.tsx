import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import interFont from "@fontsource-variable/inter/wght.css?url";
import globalStyles from "@/app/globals.css?url";
import { GameModeProvider } from "@/components/game-mode/context";
import { ItemRundownProvider } from "@/app/components/item/rundown/rundown-link";
import { CloudflareAnalytics } from "@/app/components/global/cloudflare-analytics";
import { UsagePageViews } from "@/app/components/global/usage-page-views";
import { Header } from "@/app/components/global/header";
import { SiteFooter } from "@/app/components/global/site-footer";
import { ServiceWorker } from "@/app/components/global/service-worker";
import { ContentScaleSync } from "@/app/components/global/content-scale";
import { SyncStatus } from "@/app/components/account/sync-status";
import { LibraryMigration } from "@/app/components/account/library-migration";
import { contentScaleScript } from "@/app/lib/settings/content-scale";
import { pageHead } from "@/app/lib/seo/metadata";

export const Route = createRootRoute({
  head: ({ matches }) => {
    // A page's own route emits its metadata (pageHead); an unknown URL has only the site's. A 404 isn't indexed.
    const notFound = matches.some((match) => match.status === "notFound" || (match as { globalNotFound?: boolean }).globalNotFound);
    const site = matches.some((match) => match.staticData.pageHead) ? { meta: [], links: [] } : pageHead();
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { name: "theme-color", content: "#070707" },
        { name: "color-scheme", content: "dark" },
        ...(notFound ? [{ name: "robots", content: "noindex" }] : []),
        ...site.meta,
      ],
      links: [
        { rel: "preconnect", href: "https://assets.tarkov.dev" },
        { rel: "stylesheet", href: interFont },
        { rel: "stylesheet", href: globalStyles },
        ...site.links,
        { rel: "icon", href: "/favicon.ico", sizes: "64x64", type: "image/x-icon" },
      ],
    };
  },
  shellComponent: RootDocument,
  component: Outlet,
});

// Pages are cached and served to everyone, so nothing here reads the request: no per-request CSP
// nonce (see src/app/lib/security/headers.ts) and no cookies.
function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The inline script sets the saved content size on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: contentScaleScript() }} />
        <HeadContent />
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
        <SyncStatus />
        <LibraryMigration />
        <CloudflareAnalytics />
        <UsagePageViews />
        <Scripts />
      </body>
    </html>
  );
}
