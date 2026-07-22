export const TARKOV_OPERATIONS = {
  itemCatalog: "item.catalog",
  groupItems: "item.group",
  itemDetail: "item.detail",
  gunList: "gun.list",
  buildItems: "gun.build-items",
  pickItems: "gun.pick-items",
  preset: "gun.preset",
  mapDetails: "map.details",
} as const;

export type TarkovOperation =
  (typeof TARKOV_OPERATIONS)[keyof typeof TARKOV_OPERATIONS];

const OPERATION_SET = new Set<string>(Object.values(TARKOV_OPERATIONS));

export function isTarkovOperation(value: unknown): value is TarkovOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
}
