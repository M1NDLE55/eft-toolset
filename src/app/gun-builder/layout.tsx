"use client";

import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main className="flex justify-center p-4 min-w-0 sm:min-h-[calc(100vh-130px)] min-h-[calc(100vh-65px)]">
      {children}
    </main>
  );
}
