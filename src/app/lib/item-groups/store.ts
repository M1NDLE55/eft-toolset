"use client";

import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import {
  MAX_GROUP_ITEM_NAME_LENGTH,
  MAX_GROUP_ITEMS,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS,
} from "./limits";

export interface Group {
  name: string;
  items: string[];
}

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

export function useGroups() {
  return useStore(GROUP_STORE);
}

export function findGroup(groups: Group[], name: string) {
  const needle = name.toLocaleLowerCase();
  return groups.find((group) => group.name.toLocaleLowerCase() === needle);
}

function validName(name: string, groups: Group[], current?: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a group name.");
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
    throw new Error(`Names can be at most ${MAX_GROUP_NAME_LENGTH} characters.`);
  }
  const existing = findGroup(groups, trimmed);
  if (existing && existing.name !== current) throw new Error("A group with this name already exists.");
  return trimmed;
}

export function createGroup(name: string) {
  const groups = readStore(GROUP_STORE);
  if (groups.length >= MAX_GROUPS) throw new Error(`You can save at most ${MAX_GROUPS} groups.`);
  const trimmed = validName(name, groups);
  writeStore(GROUP_STORE, [...groups, { name: trimmed, items: [] }]);
  return trimmed;
}

export function renameGroup(current: string, name: string) {
  const groups = readStore(GROUP_STORE);
  const trimmed = validName(name, groups, current);
  writeStore(
    GROUP_STORE,
    groups.map((group) => (group.name === current ? { ...group, name: trimmed } : group))
  );
  return trimmed;
}

export function deleteGroup(name: string) {
  writeStore(
    GROUP_STORE,
    readStore(GROUP_STORE).filter((group) => group.name !== name)
  );
}

export function addGroupItem(groupName: string, itemName: string) {
  const groups = readStore(GROUP_STORE);
  const group = groups.find((candidate) => candidate.name === groupName);
  if (!group) throw new Error("This group no longer exists.");
  if (group.items.includes(itemName)) return;
  if (group.items.length >= MAX_GROUP_ITEMS) {
    throw new Error(`A group can contain at most ${MAX_GROUP_ITEMS} items.`);
  }
  writeStore(
    GROUP_STORE,
    groups.map((candidate) =>
      candidate === group ? { ...candidate, items: [...candidate.items, itemName] } : candidate
    )
  );
}

export function removeGroupItem(groupName: string, itemName: string) {
  writeStore(
    GROUP_STORE,
    readStore(GROUP_STORE).map((group) =>
      group.name === groupName
        ? { ...group, items: group.items.filter((name) => name !== itemName) }
        : group
    )
  );
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
