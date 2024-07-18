import { customDecodeURI } from "@/app/lib/URIEncoding";

export function createItem(item, itemName) {
  const fleaMarket =
    (item.fleaMarketFee &&
      item.sellFor.find((sellFor) => sellFor.vendor.name === "Flea Market")) ||
    null;

  return {
    name: itemName,
    fleaMarketFee: item.fleaMarketFee,
    gridImageLink: item.gridImageLink,
    wikiLink: item.wikiLink,
    buyFor: [
      item.buyFor.reduce((acc, buyFor) => {
        if (buyFor.vendor.name === "Flea Market") {
          return acc;
        }
        if (!acc || buyFor.priceRUB < acc.priceRUB) {
          return buyFor;
        }
        return acc;
      }, null),
      fleaMarket,
    ]
      .filter((item) => item !== null)
      .sort((a, b) => a.priceRUB - b.priceRUB),
    sellFor: [
      item.sellFor.reduce((acc, sellFor) => {
        if (sellFor.vendor.name === "Flea Market") {
          return acc;
        }
        if (!acc || sellFor.priceRUB > acc.priceRUB) {
          return sellFor;
        }
        return acc;
      }, null),
      ,
      fleaMarket,
    ]
      .filter((item) => item !== null)
      .sort((a, b) => b.priceRUB - a.priceRUB),
    usedInTasks: item.usedInTasks.sort((a, b) => {
      if (a.trader.name < b.trader.name) {
        return -1;
      }
      if (a.trader.name > b.trader.name) {
        return 1;
      }
      return a.minPlayerLevel - b.minPlayerLevel;
    }),
  };
}

export function getParam(params) {
  const paramItemName = params.itemName;

  const URLParams = new URLSearchParams(params);
  const itemName = customDecodeURI(URLParams.get("itemName"));

  return { itemName: itemName, paramItemName: paramItemName };
}
