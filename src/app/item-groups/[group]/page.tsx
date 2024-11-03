"use client";

import { Group } from "@/app/lib/types/itemGroups";
import { Rubles } from "@/app/lib/currency";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { customEncodeURI } from "@/app/lib/URIEncoding";
import Image from "next/image";
import { useQuery } from "@apollo/client";
import { ITEMS_IN_GROUP } from "@/app/lib/queries";
import QueryError from "@/app/components/global/error/query-error";

export default function Page() {
  const groupName = useParams<{ group: string }>().group;
  const [names, setNames] = useState<string[]>([]);
  const { data, loading, error } = useQuery(ITEMS_IN_GROUP, {
    variables: { names: names },
    skip: names.length === 0,
  });

  const groups = localStorage.getItem("item-groups");

  if (!groups) notFound();

  const group = (JSON.parse(groups) as Group[]).find(
    (group) => group.name.toLowerCase() === groupName.toLowerCase()
  );

  if (!group) notFound();

  useEffect(() => {
    setNames(group.items);
  }, []);

  if (loading || !data)
    return (
      <div className="max-w-4xl w-full flex flex-col gap-4">
        <h1 className="text-3xl text-neutral-200">{groupName}</h1>
        <div className="w-full bg-neutral-700 p-3 animate-pulse rounded-md">
          <div className="w-full p-2 bg-neutral-500 mb-2 rounded-md"></div>
          <div className="w-full p-2 bg-neutral-500 rounded-md"></div>
        </div>
      </div>
    );

  if (error) return <QueryError error={error} />;

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
            {data.items.map(
              (item) =>
                item && (
                  <tr
                    key={item.name}
                    className="odd:bg-neutral-800 border-t border-neutral-600"
                  >
                    <td className="p-3">
                      <Image
                        alt={item.name!}
                        src={item.gridImageLink!}
                        width={64}
                        height={64}
                      />
                    </td>
                    <td className="p-3">
                      <Link
                        href={{
                          pathname: `/item/${customEncodeURI(item.name!)}`,
                        }}
                        className="underline underline-offset-2"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="p-3">
                      {item.sellFor && item.sellFor.length > 0
                        ? Rubles.format(
                            [...item.sellFor].sort(
                              (a, b) => b.priceRUB! - a.priceRUB!
                            )[0].priceRUB! /
                              (item.width * item.height)
                          )
                        : "n/a"}
                    </td>
                    <td className="p-3">
                      {item.sellFor && item.sellFor.length > 0
                        ? Rubles.format(
                            [...item.sellFor].sort(
                              (a, b) => b.priceRUB! - a.priceRUB!
                            )[0].priceRUB!
                          )
                        : "n/a"}
                    </td>
                    <td className="p-3">
                      {item.changeLast48hPercent ? (
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
                      <a href={item.wikiLink!}>
                        <LinkIcon className="hover:scale-105 transition-transform w-full" />
                      </a>
                    </td>
                  </tr>
                )
            )}
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
