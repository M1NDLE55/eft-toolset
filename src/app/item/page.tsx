export default function Page() {
  return (
    <h1 className="hidden">
      Find information on any item in Escape From Tarkov
    </h1>
  );
}
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Item database",
  description: "Find Escape from Tarkov item prices, trader offers, tasks, barters, and crafts.",
  alternates: { canonical: "/item" },
};
