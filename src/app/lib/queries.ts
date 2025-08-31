import { gql } from "@/__generated__";

export const ALL_ITEMS = gql(`
  query AllItems{
    items {
      name
    }
  }
`);

export const ITEM_PREVIEW = gql(`
  query ItemPreview($name: String) {
    items(name: $name) {
      gridImageLink
    }
  }
`);

export const ITEMS_IN_GROUP = gql(`
  query ItemsInGroup($names: [String], $gameMode: GameMode) {
    items(gameMode: $gameMode, names: $names) {
      name
      gridImageLink
      wikiLink
      sellFor {
        priceRUB
      }
      width
      height
      changeLast48hPercent
    }
  }
`);

export const GET_ITEM = gql(`
  query GetItem($name: String, $gameMode: GameMode) {
    items(gameMode: $gameMode, name: $name) {
      name
      fleaMarketFee
      gridImageLink
      wikiLink
      buyFor {
        vendor {
          name
        }
        priceRUB
      }
      sellFor {
        vendor {
          name
        }
        priceRUB
      }
      usedInTasks {
        name
        minPlayerLevel
        trader {
          name
        }
        objectives {
          description
        }
        wikiLink
      }
      width
      height
      changeLast48hPercent
      bartersUsing {
        trader {
          name
        }
        level
        taskUnlock {
          name
          wikiLink
        }
        requiredItems {
          item {
            name
          }
          quantity
        }
        rewardItems {
          item {
            name
          }
          quantity
        }
      }
      craftsUsing {
        station {
          name
        }
        level
        taskUnlock {
          name
          wikiLink
        }
        requiredItems {
          item {
            name
          }
          quantity
        }
        rewardItems {
          item {
            name
          }
          quantity
        }
      }
    }
  }
`);
