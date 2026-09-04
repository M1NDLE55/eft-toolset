"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Item } from "@/app/lib/types/item";
import { Rubles } from "@/app/lib/currency";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpDown, ArrowUpRight, Link2 as LinkIcon, MoreHorizontal } from "lucide-react";
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

        return item.gridImageLink ? (
          <Image
            src={item.gridImageLink}
            alt={item.name ?? "Item"}
            width={64}
            height={64}
          />
        ) : (
          <span className="text-xs text-muted-foreground">No image</span>
        );
      },
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button variant="ghost" className="p-0 hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Item
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const item = row.original;

        return (
          <Link href={`/item/${customEncodeURI(item.name ?? "")}`}>
            {item.name ?? "Unknown item"}
            <ArrowUpRight className="inline" size={16} />
          </Link>
        );
      },
    },
    {
      id: "slot",
      accessorFn: (item) =>
        item.sellFor && item.sellFor.length > 0 && item.width > 0 && item.height > 0
          ? [...item.sellFor].sort((a, b) => b.priceRUB! - a.priceRUB!)[0].priceRUB! / (item.width * item.height)
          : 0,
      header: ({ column }) => (
        <Button variant="ghost" className="p-0 hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Slot Value
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const value = row.getValue("slot") as number;
        return value > 0 ? Rubles.format(value) : "n/a";
      },
    },
    {
      id: "price",
      accessorFn: (item) =>
        item.sellFor && item.sellFor.length > 0
          ? [...item.sellFor].sort((a, b) => b.priceRUB! - a.priceRUB!)[0].priceRUB!
          : 0,
      header: ({ column }) => (
        <Button variant="ghost" className="p-0 hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Price
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const value = row.getValue("price") as number;
        return value > 0 ? Rubles.format(value) : "n/a";
      },
    },
    // {
    //   accessorKey: "changeLast48hPercent",
    //   header: "48h",
    //   cell: ({ row }) => {
    //     const item = row.original;

    //     return item.changeLast48hPercent ? (
    //       <span
    //         className={`${
    //           item.changeLast48hPercent >= 0 ? "text-green-400" : "text-red-400"
    //         }`}
    //       >
    //         {item.changeLast48hPercent}%
    //       </span>
    //     ) : (
    //       "n/a"
    //     );
    //   },
    // },
    {
      accessorKey: "wikiLink",
      header: "Wiki",
      cell: ({ row }) => {
        const item = row.original;

        return item.wikiLink ? (
          <a href={item.wikiLink} target="_blank" rel="noopener noreferrer">
            <LinkIcon />
            <span className="sr-only">Open wiki for {item.name}</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">n/a</span>
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
