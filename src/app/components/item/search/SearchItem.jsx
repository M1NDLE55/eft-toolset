"use client";

import { useParams, useRouter } from "next/navigation";
import SearchWrapper from "../../global/search/SearchWrapper";
import { customEncodeURI } from "@/app/lib/URIEncoding";

export default function SearchItem() {
  const router = useRouter();
  const params = useParams();

  function handleSelect(itemName) {
    router.push(`/item/${customEncodeURI(itemName)}`);
  }

  return <SearchWrapper handleSelect={handleSelect} params={params} />;
}
