"use client";

import { useEffect } from "react";
import { GraphQLV2, allItemsQuery } from "@/app/lib/GraphQL";

type Data = {
  items: { name: String }[];
  errors?: { message: String }[];
};

export default function FetchData() {
  useEffect(() => {
    async function fetchData() {
      const data = (await GraphQLV2(allItemsQuery)) as Data;

      if (data.errors) {
        data.errors.forEach((error) => {
          console.error(error.message);
        });
        alert("Couldn't load items.");
        return;
      }

      const allItems = data.items.filter(
        (item, i, array) =>
          i === array.findIndex((tempItem) => tempItem.name === item.name)
      );

      localStorage.setItem("items", JSON.stringify(allItems));
    }

    fetchData();
  }, []);
}
