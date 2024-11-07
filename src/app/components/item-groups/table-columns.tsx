"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Item } from "@/app/lib/types/item";
import { Rubles } from "@/app/lib/currency";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Link2 as LinkIcon, MoreHorizontal } from "lucide-react";
import { customEncodeURI } from "@/app/lib/URIEncoding";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function getColumns(handleRemove: (name: string) => void) {
  const columns: ColumnDef<Item>[] = [
    {
      accessorKey: "gridImageLink",
      header: "Image",
      cell: ({ row }) => {
        const item = row.original;

        return (
          <Image
            src={item.gridImageLink!}
            alt={item.name!}
            width={64}
            height={64}
          />
        );
      },
    },
    {
      accessorKey: "name",
      header: "Item",
      cell: ({ row }) => {
        const item = row.original;

        return (
          <Link href={`/item/${customEncodeURI(item.name!)}`}>
            {item.name!}
            <ArrowUpRight className="inline" size={16} />
          </Link>
        );
      },
    },
    {
      accessorKey: "slot",
      header: "Slot Value",
      cell: ({ row }) => {
        const item = row.original;

        return item.sellFor && item.sellFor.length > 0
          ? Rubles.format(
              [...item.sellFor].sort((a, b) => b.priceRUB! - a.priceRUB!)[0]
                .priceRUB! /
                (item.width * item.height)
            )
          : "n/a";
      },
    },
    {
      accessorKey: "price",
      header: "Price",
      cell: ({ row }) => {
        const item = row.original;

        return item.sellFor && item.sellFor.length > 0
          ? Rubles.format(
              [...item.sellFor].sort((a, b) => b.priceRUB! - a.priceRUB!)[0]
                .priceRUB!
            )
          : "n/a";
      },
    },
    {
      accessorKey: "changeLast48hPercent",
      header: "48h",
      cell: ({ row }) => {
        const item = row.original;

        return item.changeLast48hPercent ? (
          <span
            className={`${
              item.changeLast48hPercent >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {item.changeLast48hPercent}%
          </span>
        ) : (
          "n/a"
        );
      },
    },
    {
      accessorKey: "wikiLink",
      header: "Wiki",
      cell: ({ row }) => {
        const item = row.original;

        return (
          <Link href={item.wikiLink!}>
            <LinkIcon />
          </Link>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const item = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  handleRemove(item.name!);
                }}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return columns;
}
