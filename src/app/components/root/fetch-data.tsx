"use client";

import { useQuery } from "@apollo/client";
import { ALL_ITEMS } from "@/app/lib/queries";
import client from "@/app/lib/apolloClient";

export default function PreFetchData() {
  const { data, loading, error } = useQuery(ALL_ITEMS, {
    client: client,
  });

  if (loading) {
    return null;
  }

  if (error || !data) {
    console.warn("Couldn't fetch item names");
    return null;
  }

  // remove duplicates
  const allItems = data.items.filter(
    (item, i, array) =>
      i === array.findIndex((tempItem) => tempItem!.name === item!.name)
  );

  localStorage.setItem("items", JSON.stringify(allItems));

  return null;
}
