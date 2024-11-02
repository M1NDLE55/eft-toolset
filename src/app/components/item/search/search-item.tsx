"use client";

import { useParams, useRouter } from "next/navigation";
import SearchWrapper from "../../global/search/search-wrapper";
import { customEncodeURI } from "@/app/lib/URIEncoding";
export default function SearchItem() {
  const router = useRouter();
  const params = useParams<{ itemName: string }>();

  function handleSelect(itemName: string) {
    router.push(`/item/${customEncodeURI(itemName)}`);
  }

  return <SearchWrapper handleSelect={handleSelect} params={params} />;
}
