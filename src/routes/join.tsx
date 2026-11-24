import { createFileRoute } from "@tanstack/react-router";
import { JoinPage } from "@/app/join/join-page";
import { PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";

export const Route = createFileRoute("/join")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: PRIVATE_PAGE_METADATA, page: { title: "Join a raid plan" } }),
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }),
  component: JoinPage,
});
