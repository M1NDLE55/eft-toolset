import type { ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { ItemTemporarilyUnavailableError, isCrawlerRequest, resolveItemRoute } from "./item-route";

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ itemName: string }> }) {
  const segment = (await params).itemName;
  const { item, canonical, reference } = await resolveItemRoute(segment);
  if (canonical && canonical !== segment) permanentRedirect(`/item/${canonical}`);
  if (!reference || item === null) notFound();
  // Visitors get the page and load the item in the browser; crawlers get a server error to retry.
  if (item === undefined && (await isCrawlerRequest())) throw new ItemTemporarilyUnavailableError();
  return children;
}
