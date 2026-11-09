import { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gun builder",
  description: "Build Escape from Tarkov weapons and compare stats and prices.",
  alternates: { canonical: "/gun-builder" },
  openGraph: {
    title: "Gun builder | EFT Toolset",
    description: "Build Escape from Tarkov weapons and compare stats and prices.",
    url: "/gun-builder",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gun builder | EFT Toolset",
    description: "Build Escape from Tarkov weapons and compare stats and prices.",
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
