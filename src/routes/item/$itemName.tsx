import { createFileRoute } from "@tanstack/react-router";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import { ItemPage } from "@/app/item/detail/item-page";
import { ITEM_LAYOUT_METADATA } from "@/app/item/item-layout";
import { fetchItemPage } from "@/app/item/item.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/item/$itemName")({
  loader: ({ params }) => fetchItemPage({ data: { itemName: params.itemName } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ layouts: [ITEM_LAYOUT_METADATA], page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.builds),
  pendingComponent: LoadingSkeleton,
  component: function ItemRoute() {
    return <ItemPage data={Route.useLoaderData()} />;
  },
});
