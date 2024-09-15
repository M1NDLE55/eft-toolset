"use client";

import { Group } from "@/app/components/item-groups/types";
import { Rubles } from "@/app/lib/Currency";
import { GraphQLV2, itemsInGroupQuery } from "@/app/lib/GraphQL";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type Item = {
  name: string;
  fleaMarketFee: number;
  gridImageLink: string;
  wikiLink: string;
  width: number;
  height: number;
  changeLast48hPercent: number;
  buyFor: {
    vendor: {
      name: string;
    };
    priceRUB: number;
  }[];
  sellFor: {
    vendor: {
      name: string;
    };
    priceRUB: number;
  }[];
};

type Data = {
  items: Item[];
  errors?: {
    message: string;
  }[];
};

export default function Page() {
  const groupName = useParams<{ group: string }>().group;
  const [data, setData] = useState<Data>();
  const [isLoading, setIsloading] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setIsloading(true);

      const groups = localStorage.getItem("item-groups");

      if (!groups) notFound();

      const group = (JSON.parse(groups) as Group[]).find(
        (group) => group.name.toLowerCase() === groupName.toLowerCase()
      );

      if (!group) notFound();

      const data = (await GraphQLV2(itemsInGroupQuery, {
        names: group.items,
      })) as Data;

      setData(data);

      setIsloading(false);
    }

    fetchData();
  }, []);

  if (isLoading)
    return (
      <>
        <h1 className="text-3xl text-neutral-200">{groupName}</h1>
        <div className="w-full bg-neutral-700 p-3 animate-pulse rounded-md">
          <div className="w-full p-2 bg-neutral-500 mb-2 rounded-md"></div>
          <div className="w-full p-2 bg-neutral-500 rounded-md"></div>
        </div>
      </>
    );

  if (data?.errors)
    return (
      <>
        <h1 className="text-3xl text-neutral-200">{groupName}</h1>
        <div className="bg-red-200 border-red-700 border rounded-md p-3 flex flex-row gap-2">
          <AlertTriangle className="text-red-700" />
          <div className="flex flex-col gap-2">
            {data.errors.map((error, i) => (
              <p className="text-red-700" key={error.message + `${i}`}>
                {error.message}
              </p>
            ))}
          </div>
        </div>
      </>
    );

  return (
    <>
      <h1 className="text-3xl text-neutral-200">{groupName}</h1>
      <table className="bg-neutral-700 w-full rounded-md text-left border border-neutral-600 shadow-md overflow-hidden text-neutral-200">
        <thead>
          <tr>
            <th className="p-3 text-lg">Item</th>
            <th className="p-3 text-lg">Price</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((item) => (
            <tr
              key={item.name}
              className="odd:bg-neutral-800 border-t border-neutral-600"
            >
              <td className="p-3">{item.name}</td>
              <td className="p-3">
                {Rubles.format(
                  item.sellFor.sort((a, b) =>
                    a.priceRUB < b.priceRUB ? 1 : -1
                  )[0].priceRUB
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
