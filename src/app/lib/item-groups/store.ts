"use client";

import type { Group } from "@/app/lib/types/itemGroups";
import { readStore, subscribeStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";

const DEFAULT_GROUPS: Group[] = [
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
];

const GROUP_STORE: StoreDefinition<Group[]> = {
  key: "eft-toolset:item-groups",
  legacyKeys: ["item-groups"],
  version: 1,
  defaultValue: () => structuredClone(DEFAULT_GROUPS),
  validate: isGroupList,
};

export function listGroups() {
  return readStore(GROUP_STORE);
}

export function saveGroups(groups: Group[]) {
  return writeStore(GROUP_STORE, groups);
}

export function subscribeGroups(listener: () => void) {
  return subscribeStore(GROUP_STORE.key, listener);
}

function isGroupList(value: unknown): value is Group[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(
      (group) =>
        Boolean(group) &&
        typeof group.name === "string" &&
        group.name.trim().length > 0 &&
        group.name.length <= 120 &&
        Array.isArray(group.items) &&
        group.items.length <= 2_000 &&
        group.items.every(
          (item: unknown) => typeof item === "string" && item.length <= 240
        )
    )
  );
}
