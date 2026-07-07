import { ReactNode } from "react";

export const metadata = {
  title: "EFT Toolset | Raid planner",
  description: "Plan Escape From Tarkov raids on clean interactive maps",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="min-w-0">{children}</main>;
}
