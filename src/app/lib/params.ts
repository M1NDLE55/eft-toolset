import { Params } from "next/dist/shared/lib/router/utils/route-matcher";
import { customDecodeURI } from "./URIEncoding";

export function getParam(params: Params) {
  const URLParams = new URLSearchParams(params);

  const paramItemName = URLParams.get("itemName") as string;
  const itemName = paramItemName && customDecodeURI(paramItemName);

  return {
    itemName: itemName,
    paramItemName: paramItemName,
  };
}
