// @ts-expect-error
import { gql, request } from "graphql-request";

type Variables = {
  name?: string;
  names?: string[];
};

export async function GraphQLV2(query: any, variables?: Variables) {
  try {
    const data = await request(
      "https://api.tarkov.dev/graphql",
      query,
      variables || null
    );
    return data;
  } catch (error) {
    console.log((error as Error).toString());
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

export const itemPreviewQuery = gql`
  query itemPreviewQuery($name: String) {
    items(name: $name) {
      gridImageLink
    }
  }
`;

export const itemsInGroupQuery = gql`
  query itemsInGroupQuery($names: [String]) {
    items(names: $names) {
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
