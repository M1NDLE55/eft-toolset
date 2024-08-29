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
    slots: item.width * item.height,
    changeLast48hPercent: item.changeLast48hPercent,
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
    bartersUsing: item.bartersUsing.sort((a, b) => {
      if (a.trader.name < b.trader.name) {
        return -1;
      }

      if (a.trader.name > b.trader.name) {
        return 1;
      }

      return a.level - b.level;
    }),
    craftsUsing: item.craftsUsing.sort((a, b) => {
      if (a.station.name < b.station.name) {
        return -1;
      }

      if (a.station.name > b.station.name) {
        return 1;
      }

      return a.level - b.level;
    }),
  };
}

export function getParam(params) {
  const URLParams = new URLSearchParams(params);

  const paramItemName = URLParams.get("itemName");
  const itemName = customDecodeURI(paramItemName);

  return {
    itemName: itemName,
    paramItemName: paramItemName,
  };
}
