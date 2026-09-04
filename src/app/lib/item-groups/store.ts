"use client";

import type { Group } from "@/app/lib/types/itemGroups";
import { readStore, subscribeStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import {
  MAX_GROUP_ITEM_NAME_LENGTH,
  MAX_GROUP_ITEMS,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS,
} from "./limits";

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
  recover: recoverGroups,
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
  return Array.isArray(value) && value.length <= MAX_GROUPS && value.every(isGroup);
}

function recoverGroups(value: unknown): Group[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .flatMap((candidate): Group[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const group = candidate as Partial<Group>;
      if (
        typeof group.name !== "string" ||
        !group.name.trim() ||
        group.name.length > MAX_GROUP_NAME_LENGTH ||
        !Array.isArray(group.items)
      ) {
        return [];
      }
      return [{
        name: group.name,
        items: group.items
          .filter(
            (item): item is string =>
              typeof item === "string" && item.length <= MAX_GROUP_ITEM_NAME_LENGTH
          )
          .slice(0, MAX_GROUP_ITEMS),
      }];
    })
    .slice(0, MAX_GROUPS);
}

function isGroup(value: unknown): value is Group {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<Group>;
  return (
    typeof group.name === "string" &&
    group.name.trim().length > 0 &&
    group.name.length <= MAX_GROUP_NAME_LENGTH &&
    Array.isArray(group.items) &&
    group.items.length <= MAX_GROUP_ITEMS &&
    group.items.every(
      (item: unknown) =>
        typeof item === "string" && item.length <= MAX_GROUP_ITEM_NAME_LENGTH
    )
  );
}
