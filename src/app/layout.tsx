import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Github } from "lucide-react";
import { ReactNode } from "react";
import PreFetchData from "./components/root/fetch-data";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { GameModeProvider } from "@/components/game-mode/context";
import { Header } from "@/app/components/global/header";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <GameModeProvider>
            <Header />
            <PreFetchData />
            {children}
          </GameModeProvider>
          <footer className="border-t p-4 min-h-16 flex justify-center items-center">
            <div className="w-full max-w-7xl flex sm:flex-row sm:justify-between flex-col-reverse items-center gap-4">
              <div className="flex sm:flex-row flex-col-reverse items-center gap-4">
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
        </ThemeProvider>
      </body>
    </html>
  );
}
