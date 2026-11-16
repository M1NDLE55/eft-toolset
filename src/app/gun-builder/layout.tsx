import { ReactNode } from "react";
import type { Metadata } from "next";
import { GUN_BUILDER_TITLE, GUN_BUILDER_DESCRIPTION } from "@/app/lib/seo/site-copy";

export const metadata: Metadata = {
  title: "Gun builder",
  description: GUN_BUILDER_DESCRIPTION,
  alternates: { canonical: "/gun-builder" },
  openGraph: {
    title: `${GUN_BUILDER_TITLE} | EFT Toolset`,
    description: GUN_BUILDER_DESCRIPTION,
    url: "/gun-builder",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${GUN_BUILDER_TITLE} | EFT Toolset`,
    description: GUN_BUILDER_DESCRIPTION,
    images: ["/home-og-image.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 justify-center p-4 pb-10">
      {children}
    </main>
  );
}
