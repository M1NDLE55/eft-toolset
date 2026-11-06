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

export const CACHEABLE_OPERATIONS: ReadonlySet<TarkovOperation> = new Set([
  TARKOV_OPERATIONS.itemCatalog,
  TARKOV_OPERATIONS.itemDetail,
  TARKOV_OPERATIONS.gunList,
  TARKOV_OPERATIONS.preset,
  TARKOV_OPERATIONS.mapDetails,
]);

export const MAX_GET_VARIABLES_LENGTH = 1_024;

export function isTarkovOperation(value: unknown): value is TarkovOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
