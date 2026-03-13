export const BULK_ITEMS = `
  query BulkItems($gameMode: GameMode, $limit: Int, $offset: Int) {
    items(gameMode: $gameMode, limit: $limit, offset: $offset) {
      name
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
      usedInTasks { name }
    }
  }
`;

export const BULK_TASKS = `
  query BulkTasks($gameMode: GameMode, $limit: Int, $offset: Int) {
    tasks(gameMode: $gameMode, limit: $limit, offset: $offset) {
      name
      minPlayerLevel
      wikiLink
      trader { name }
      objectives { description }
    }
  }
`;

export const BULK_BARTERS = `
  query BulkBarters($gameMode: GameMode, $limit: Int, $offset: Int) {
    barters(gameMode: $gameMode, limit: $limit, offset: $offset) {
      trader { name }
      level
      taskUnlock { name wikiLink }
      requiredItems { item { name } quantity }
      rewardItems { item { name } quantity }
    }
  }
`;

export const BULK_CRAFTS = `
  query BulkCrafts($gameMode: GameMode, $limit: Int, $offset: Int) {
    crafts(gameMode: $gameMode, limit: $limit, offset: $offset) {
      station { name }
      level
      taskUnlock { name wikiLink }
      requiredItems { item { name } quantity }
      rewardItems { item { name } quantity }
    }
  }
`;

export const GET_ITEM = `
  query GetItem($name: String, $gameMode: GameMode) {
    items(gameMode: $gameMode, name: $name) {
      name
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
