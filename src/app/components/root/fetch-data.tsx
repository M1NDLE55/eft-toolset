"use client";

import { useQuery } from "@apollo/client";
import { ALL_ITEMS } from "@/app/lib/queries";
import client from "@/app/lib/apolloClient";
import { useEffect } from "react";
import { Group } from "@/app/lib/types/itemGroups";

export default function PreFetchData() {
  const { data, error } = useQuery(ALL_ITEMS, {
    client: client,
  });

  useEffect(() => {
    // initial groups

    const init = localStorage.getItem("init");

    if (!init) {
      localStorage.setItem("init", "false");

      const g = localStorage.getItem("item-groups");
      const groups = g ? (JSON.parse(g) as Group[]) : [];

      if (groups.find((g) => g.name === "Injectors")) return;

      localStorage.setItem(
        "item-groups",
        JSON.stringify([
          ...groups,
          {
            name: "Injectors",
            items: [
              "Morphine injector",
              "L1 (Norepinephrine) injector",
              "Trimadol stimulant injector",
              "Adrenaline injector",
              "Propital regenerative stimulant injector",
              "eTG-change regenerative stimulant injector",
              "xTG-12 antidote injector",
              "Perfotoran (Blue Blood) stimulant injector",
              "AHF1-M stimulant injector",
              "Zagustin hemostatic drug injector",
              "PNB (Product 16) stimulant injector",
              "P22 (Product 22) stimulant injector",
              "Meldonin injector",
              "SJ1 TGLabs combat stimulant injector",
              "SJ6 TGLabs combat stimulant injector",
              "3-(b-TG) stimulant injector",
              "2A2-(b-TG) stimulant injector",
              "Obdolbos cocktail injector",
              "Obdolbos 2 cocktail injector",
              "M.U.L.E. stimulant injector",
              "SJ9 TGLabs combat stimulant injector",
              "SJ12 TGLabs combat stimulant injector",
            ],
          },
        ])
      );
    }
  }, []);

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

  return null;
}
