import { gql, request } from "graphql-request";

export async function GraphQLV2(query, variables = null) {
  try {
    const data = await request(
      "https://api.tarkov.dev/graphql",
      query,
      variables
    );
    return data;
  } catch (error) {
    console.log(error.toString());
    return {
      errors: [
        {
          message: "A problem occured while fetching the data",
        },
      ],
    };
  }
}

export const allItemsQuery = gql`
  query allItemsQuery {
    items {
      name
    }
  }
`;

export const itemMetaQuery = gql`
  query itemMetaQuery($name: String) {
    items(name: $name) {
      inspectImageLink
    }
  }
`;

export const itemDataQuery = gql`
  query itemDataQuery($name: String) {
    items(name: $name) {
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
`;
