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
      //   const data = await GraphQLV2(allItemsQuery);
      const data = { items: [{ name: "Item 1" }, { name: "Item 2" }] } as Data;

      if (data.errors) {
        console.error(data.errors);
        alert("Couldn't load items. Please refresh the page.");
        return;
      }

      const allItems = data.items.filter(
        (item, i, array) =>
          i === array.findIndex((tempItem) => tempItem.name === item.name)
      );

      localStorage.setItem("items", JSON.stringify(allItems));
      if (localStorage.getItem("items")) {
        console.log(JSON.parse(localStorage.getItem("items") as string));
      }
    }

    fetchData();
  }, []);
}
