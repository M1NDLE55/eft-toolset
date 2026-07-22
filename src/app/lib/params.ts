import { customDecodeURI } from "./URIEncoding";

export function getParam(params: Record<string, string | string[] | undefined>) {
  const raw = params.itemName;
  const paramItemName = Array.isArray(raw) ? raw[0] : raw;
  const itemName = paramItemName ? customDecodeURI(paramItemName) : "";

  return {
    itemName: itemName,
    paramItemName: paramItemName,
  };
}
