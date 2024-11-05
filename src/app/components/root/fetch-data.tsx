"use client";

import { useQuery } from "@apollo/client";
import { ALL_ITEMS } from "@/app/lib/queries";
import client from "@/app/lib/apolloClient";
import { useEffect } from "react";

export default function PreFetchData() {
  const { data, error } = useQuery(ALL_ITEMS, {
    client: client,
  });

  useEffect(() => {
    if (error) {
      console.warn("Couldn't fetch item names");
      return;
    }

    if (data) {
      // remove duplicates
      const allItems = data.items.filter(
        (item, i, array) =>
          i === array.findIndex((tempItem) => tempItem!.name === item!.name)
      );

      localStorage.setItem("items", JSON.stringify(allItems));
    }
  }, [data, error]);
}
