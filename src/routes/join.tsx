import { createFileRoute } from "@tanstack/react-router";
import { JoinPage } from "@/app/join/join-page";
import { PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";
import { loadWithoutBeacon } from "@/app/components/global/cloudflare-analytics";

export const Route = createFileRoute("/join")({
  // Paths with codes or plan ids are never seen by the analytics beacon (§16.4).
  beforeLoad: ({ location }) => loadWithoutBeacon(location.href),
  staticData: { pageHead: true },
  head: () => pageHead({ own: PRIVATE_PAGE_METADATA, page: { title: "Join a raid plan" } }),
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }),
  component: JoinPage,
});
