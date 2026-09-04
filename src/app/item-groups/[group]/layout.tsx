import type { Metadata } from "next";
import type { ReactNode } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { notFound } from "next/navigation";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ group: string }>;
}) {
  if (!customDecodeURI((await params).group)) notFound();
  return children;
}
