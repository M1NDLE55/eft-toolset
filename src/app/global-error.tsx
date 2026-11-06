"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4 text-center">
        <p className="bg-[#9a8866] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-black">System error</p>
        <h1 className="text-3xl font-black uppercase tracking-[0.3em] text-[#9a8866]">Something broke</h1>
        <button
          type="button"
          onClick={reset}
          className="border border-[#9a8866] px-6 py-2 text-xs font-bold uppercase tracking-widest text-[#9a8866] transition-colors hover:bg-[#9a8866] hover:text-black"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
