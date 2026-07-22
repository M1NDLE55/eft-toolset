const ITEM_CORE_FIELDS = /* GraphQL */ `
  id
  normalizedName
  name
  shortName
  gridImageLink
  wikiLink
  fleaMarketFee
  width
  height
  changeLast48hPercent
  buyFor {
    vendor { name }
    priceRUB
  }
  sellFor {
    vendor { name }
    priceRUB
  }
`;

export const ITEM_CATALOG = /* GraphQL */ `
  query ItemCatalog($gameMode: GameMode, $limit: Int, $offset: Int) {
    items(gameMode: $gameMode, limit: $limit, offset: $offset) {
      id
      normalizedName
      name
      shortName
      gridImageLink
    }
  }
`;

export const GROUP_ITEMS = /* GraphQL */ `
  query GroupItems($names: [String], $gameMode: GameMode) {
    items(gameMode: $gameMode, names: $names) {
      ${ITEM_CORE_FIELDS}
      usedInTasks { name }
    }
  }
`;

export const GET_ITEM = /* GraphQL */ `
  query GetItem($names: [String], $gameMode: GameMode) {
    items(gameMode: $gameMode, names: $names) {
      ${ITEM_CORE_FIELDS}
      usedInTasks {
        name
        minPlayerLevel
        wikiLink
        trader { name }
        objectives { description }
      }
      bartersUsing {
        trader { name }
        level
        taskUnlock { name wikiLink }
        requiredItems { item { name } quantity }
        rewardItems { item { name } quantity }
      }
      craftsUsing {
        station { name }
        level
        taskUnlock { name wikiLink }
        requiredItems { item { name } quantity }
        rewardItems { item { name } quantity }
      }
    }
  }
`;
