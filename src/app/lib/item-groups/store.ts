import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import {
  MAX_GROUP_ITEM_NAME_LENGTH,
  MAX_GROUP_ITEMS,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS,
} from "./limits";
import { isGroupList, type Group } from "./validation";
import { STORE_KEYS } from "@/app/lib/storage/store-keys";
import { activeLibrary, useAccountView } from "@/app/lib/account-sync/account-session";
import type { LibraryView } from "@/app/lib/account-sync/account-library";
import { USER_LIMITS } from "@/app/lib/durable/limits";

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

export const GROUP_STORE: StoreDefinition<Group[]> = {
  key: STORE_KEYS.itemGroups,
  legacyKeys: ["item-groups"],
  version: 1,
  defaultValue: () => structuredClone(DEFAULT_GROUPS),
  validate: isGroupList,
  recover: recoverGroups,
};

/*
 * Signed in, the groups come from the account library (src/app/lib/account-sync) and every change
 * below becomes a mutation; signed out, they stay in this browser's localStorage as before. Groups
 * are still addressed by name, which is unique per user either way.
 */
const accountGroupLists = new WeakMap<LibraryView["itemGroups"], Group[]>();

function accountGroups(view: LibraryView): Group[] {
  let list = accountGroupLists.get(view.itemGroups);
  if (!list) {
    list = view.itemGroups.map((group) => ({ name: group.name, items: group.items })).sort((a, b) => a.name.localeCompare(b.name));
    accountGroupLists.set(view.itemGroups, list);
  }
  return list;
}

export function useGroups() {
  const local = useStore(GROUP_STORE);
  const account = useAccountView();
  return account ? accountGroups(account) : local;
}

function readGroups(): Group[] {
  const library = activeLibrary();
  return library ? accountGroups(library.view()) : readStore(GROUP_STORE);
}

function accountGroup(name: string) {
  const library = activeLibrary();
  if (!library) return null;
  const needle = name.toLowerCase();
  const record = library.view().itemGroups.find((group) => group.name.toLowerCase() === needle);
  if (!record) throw new Error("This group no longer exists.");
  return { library, record };
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
  const groups = readGroups();
  const library = activeLibrary();
  const limit = library ? USER_LIMITS.itemGroups : MAX_GROUPS;
  if (groups.length >= limit) throw new Error(`You can save at most ${limit} groups.`);
  const trimmed = validName(name, groups);
  if (library) {
    library.createGroup({ name: trimmed, items: [] });
    return trimmed;
  }
  writeStore(GROUP_STORE, [...groups, { name: trimmed, items: [] }]);
  return trimmed;
}

export function renameGroup(current: string, name: string) {
  const groups = readGroups();
  const trimmed = validName(name, groups, current);
  const account = accountGroup(current);
  if (account) {
    account.library.update("item_group", account.record.id, { ...account.record, name: trimmed });
    return trimmed;
  }
  writeStore(
    GROUP_STORE,
    groups.map((group) => (group.name === current ? { ...group, name: trimmed } : group))
  );
  return trimmed;
}

export function deleteGroup(name: string) {
  const account = accountGroup(name);
  if (account) {
    account.library.remove("item_group", account.record.id);
    return;
  }
  writeStore(
    GROUP_STORE,
    readStore(GROUP_STORE).filter((group) => group.name !== name)
  );
}

export function addGroupItem(groupName: string, itemName: string) {
  const groups = readGroups();
  const group = groups.find((candidate) => candidate.name === groupName);
  if (!group) throw new Error("This group no longer exists.");
  if (group.items.includes(itemName)) return;
  if (group.items.length >= MAX_GROUP_ITEMS) {
    throw new Error(`A group can contain at most ${MAX_GROUP_ITEMS} items.`);
  }
  const account = accountGroup(groupName);
  if (account) {
    account.library.update("item_group", account.record.id, { ...account.record, items: [...account.record.items, itemName] });
    return;
  }
  writeStore(
    GROUP_STORE,
    groups.map((candidate) =>
      candidate === group ? { ...candidate, items: [...candidate.items, itemName] } : candidate
    )
  );
}

export function removeGroupItem(groupName: string, itemName: string) {
  const account = accountGroup(groupName);
  if (account) {
    account.library.update("item_group", account.record.id, { ...account.record, items: account.record.items.filter((name) => name !== itemName) });
    return;
  }
  writeStore(
    GROUP_STORE,
    readStore(GROUP_STORE).map((group) =>
      group.name === groupName
        ? { ...group, items: group.items.filter((name) => name !== itemName) }
        : group
    )
  );
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
