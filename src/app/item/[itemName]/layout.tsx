import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { customDecodeURI } from "@/app/lib/URIEncoding";

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ itemName: string }> }) {
  if (!customDecodeURI((await params).itemName)) notFound();
  return children;
}
