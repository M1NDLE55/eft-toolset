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

export function isGroupList(value: unknown): value is Group[] {
  return Array.isArray(value) && value.length <= MAX_GROUPS && value.every(isGroup);
}

export function isGroup(value: unknown): value is Group {
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
