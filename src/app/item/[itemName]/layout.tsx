import type { ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveItemRoute } from "./item-route";

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ itemName: string }> }) {
  const segment = (await params).itemName;
  const { item, canonical, reference } = await resolveItemRoute(segment);
  if (canonical && canonical !== segment) permanentRedirect(`/item/${canonical}`);
  if (!reference || item === null) notFound();
  return children;
}
