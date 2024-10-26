"use client";

import { Group } from "@/app/components/item-groups/types";
import { Rubles } from "@/app/lib/Currency";
import { GraphQLV2, itemsInGroupQuery } from "@/app/lib/GraphQL";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import Image from "next/image";

type BaseItem = {
  name: string;
  gridImageLink: string;
  wikiLink: string;
  changeLast48hPercent: number;
};

type RawItem = BaseItem & {
  width: number;
  height: number;
  sellFor: {
    priceRUB: number;
  }[];
};

type ResultItem = BaseItem & {
  slots: number;
  sellFor: {
    priceRUB: number | null;
    slotValueRUB: number | null;
  };
};

type Errors = {
  errors?:
    | {
        message: string;
      }[]
    | null;
};

type RawData = Errors & {
  items: RawItem[];
};

type ResultData = Errors & {
  items: ResultItem[];
};

export default function Page() {
  const groupName = useParams<{ group: string }>().group;
  const [data, setData] = useState<ResultData>({
    items: [],
    errors: null,
  });
  const [isLoading, setIsloading] = useState(true);

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
      })) as RawData;

      setData(
        data.items.length > 0
          ? {
              items: data.items.map((item) => {
                const slots = item.width * item.height;
                const priceRUB =
                  item.sellFor.length > 0
                    ? item.sellFor.sort((a, b) => b.priceRUB - a.priceRUB)[0]
                        .priceRUB
                    : null;

                return {
                  name: item.name,
                  gridImageLink: item.gridImageLink,
                  changeLast48hPercent: item.changeLast48hPercent,
                  slots: slots,
                  wikiLink: item.wikiLink,
                  sellFor: {
                    priceRUB: priceRUB,
                    slotValueRUB: priceRUB && priceRUB / slots,
                  },
                };
              }),
              errors: null,
            }
          : {
              items: [],
              errors: data.errors || null,
            }
      );

      setIsloading(false);
    }

    fetchData();
  }, []);

  if (isLoading)
    return (
      <div className="max-w-4xl w-full flex flex-col gap-4">
        <h1 className="text-3xl text-neutral-200">{groupName}</h1>
        <div className="w-full bg-neutral-700 p-3 animate-pulse rounded-md">
          <div className="w-full p-2 bg-neutral-500 mb-2 rounded-md"></div>
          <div className="w-full p-2 bg-neutral-500 rounded-md"></div>
        </div>
      </div>
    );

  if (data.errors)
    return (
      <div className="max-w-4xl w-full flex flex-col gap-4">
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
      </div>
    );

  return (
    <div className="max-w-4xl w-full flex flex-col gap-4">
      <div className="w-full flex gap-4 text-xl text-neutral-200 justify-between items-center">
        <h1 className="text-3xl">{groupName}</h1>
      </div>
      {data.items.length > 0 ? (
        <table className="bg-neutral-700 w-full rounded-md text-left border border-neutral-600 shadow-md overflow-hidden text-neutral-200">
          <thead>
            <tr>
              <th className="p-3 text-lg">Image</th>
              <th className="p-3 text-lg">Item</th>
              <th className="p-3 text-lg">Slot Value</th>
              <th className="p-3 text-lg">Price</th>
              <th className="p-3 text-lg">48h</th>
              <th className="p-3 text-lg text-center">Wiki</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr
                key={item.name}
                className="odd:bg-neutral-800 border-t border-neutral-600"
              >
                <td className="p-3">
                  <Image
                    alt={item.name}
                    src={item.gridImageLink}
                    width={64}
                    height={64}
                  />
                </td>
                <td className="p-3">
                  <Link
                    href={{ pathname: `/item/${customEncodeURI(item.name)}` }}
                    className="underline underline-offset-2"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className="p-3">
                  {item.sellFor.slotValueRUB !== null
                    ? Rubles.format(item.sellFor.slotValueRUB)
                    : "n/a"}
                </td>
                <td className="p-3">
                  {item.sellFor.priceRUB !== null
                    ? Rubles.format(item.sellFor.priceRUB)
                    : "n/a"}
                </td>
                <td className="p-3">
                  {item.changeLast48hPercent !== null ? (
                    <span
                      className={`${
                        item.changeLast48hPercent >= 0
                          ? "text-green-400 before:content-['+']"
                          : "text-red-400"
                      }`}
                    >
                      {item.changeLast48hPercent}%
                    </span>
                  ) : (
                    "n/a"
                  )}
                </td>
                <td className="p-3">
                  <a href={item.wikiLink}>
                    <LinkIcon className="hover:scale-105 transition-transform w-full" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="p-3 w-full rounded-md border border-neutral-600 text-xl text-neutral-600">
          No items in group
        </p>
      )}
    </div>
  );
}
