import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ map: string }> }) {
  if (!getMapConfig((await params).map)) notFound();
  return children;
}
