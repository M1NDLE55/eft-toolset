import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-1 justify-center p-4 pb-10">{children}</main>;
}
