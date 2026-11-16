import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 justify-center px-4 pb-10 pt-4">
      <div className="flex w-full max-w-2xl flex-col gap-5">{children}</div>
    </main>
  );
}
