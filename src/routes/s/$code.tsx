import { createFileRoute } from "@tanstack/react-router";
import { ShareLinkPage } from "@/app/sharing/share-link-page";
import { fetchSharePreview } from "@/app/sharing/share.functions";
import { PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";

export const Route = createFileRoute("/s/$code")({
  loader: ({ params }) => fetchSharePreview({ data: { code: params.code } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) =>
    pageHead({
      own: PRIVATE_PAGE_METADATA,
      page: loaderData?.ok
        ? { title: loaderData.title, description: loaderData.summary, openGraph: { title: loaderData.title, description: loaderData.summary } }
        : { title: "Shared link" },
    }),
  // Links carry codes: never cached, never indexed (§16.1).
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }),
  component: function ShareRoute() {
    return <ShareLinkPage preview={Route.useLoaderData()} code={Route.useParams().code} />;
  },
});
