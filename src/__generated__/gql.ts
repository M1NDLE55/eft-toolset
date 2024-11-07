/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
const documents = {
    "\n  query AllItems{\n    items {\n      name\n    }\n  }\n": types.AllItemsDocument,
    "\n  query ItemPreview($name: String) {\n    items(name: $name) {\n      gridImageLink\n    }\n  }\n": types.ItemPreviewDocument,
    "\n  query ItemsInGroup($names: [String]) {\n    items(names: $names) {\n      name\n      gridImageLink\n      wikiLink\n      sellFor {\n        priceRUB\n      }\n      width\n      height\n      changeLast48hPercent\n    }\n  }\n": types.ItemsInGroupDocument,
    "\n  query GetItem($name: String) {\n    items(name: $name) {\n      name\n      fleaMarketFee\n      gridImageLink\n      wikiLink\n      buyFor {\n        vendor {\n          name\n        }\n        priceRUB\n      }\n      sellFor {\n        vendor {\n          name\n        }\n        priceRUB\n      }\n      usedInTasks {\n        name\n        minPlayerLevel\n        trader {\n          name\n        }\n        objectives {\n          description\n        }\n        wikiLink\n      }\n      width\n      height\n      changeLast48hPercent\n      bartersUsing {\n        trader {\n          name\n        }\n        level\n        taskUnlock {\n          name\n          wikiLink\n        }\n        requiredItems {\n          item {\n            name\n          }\n          quantity\n        }\n        rewardItems {\n          item {\n            name\n          }\n          quantity\n        }\n      }\n      craftsUsing {\n        station {\n          name\n        }\n        level\n        taskUnlock {\n          name\n          wikiLink\n        }\n        requiredItems {\n          item {\n            name\n          }\n          quantity\n        }\n        rewardItems {\n          item {\n            name\n          }\n          quantity\n        }\n      }\n    }\n  }\n": types.GetItemDocument,
};

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = gql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function gql(source: string): unknown;

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n  query AllItems{\n    items {\n      name\n    }\n  }\n"): (typeof documents)["\n  query AllItems{\n    items {\n      name\n    }\n  }\n"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n  query ItemPreview($name: String) {\n    items(name: $name) {\n      gridImageLink\n    }\n  }\n"): (typeof documents)["\n  query ItemPreview($name: String) {\n    items(name: $name) {\n      gridImageLink\n    }\n  }\n"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n  query ItemsInGroup($names: [String]) {\n    items(names: $names) {\n      name\n      gridImageLink\n      wikiLink\n      sellFor {\n        priceRUB\n      }\n      width\n      height\n      changeLast48hPercent\n    }\n  }\n"): (typeof documents)["\n  query ItemsInGroup($names: [String]) {\n    items(names: $names) {\n      name\n      gridImageLink\n      wikiLink\n      sellFor {\n        priceRUB\n      }\n      width\n      height\n      changeLast48hPercent\n    }\n  }\n"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n  query GetItem($name: String) {\n    items(name: $name) {\n      name\n      fleaMarketFee\n      gridImageLink\n      wikiLink\n      buyFor {\n        vendor {\n          name\n        }\n        priceRUB\n      }\n      sellFor {\n        vendor {\n          name\n        }\n        priceRUB\n      }\n      usedInTasks {\n        name\n        minPlayerLevel\n        trader {\n          name\n        }\n        objectives {\n          description\n        }\n        wikiLink\n      }\n      width\n      height\n      changeLast48hPercent\n      bartersUsing {\n        trader {\n          name\n        }\n        level\n        taskUnlock {\n          name\n          wikiLink\n        }\n        requiredItems {\n          item {\n            name\n          }\n          quantity\n        }\n        rewardItems {\n          item {\n            name\n          }\n          quantity\n        }\n      }\n      craftsUsing {\n        station {\n          name\n        }\n        level\n        taskUnlock {\n          name\n          wikiLink\n        }\n        requiredItems {\n          item {\n            name\n          }\n          quantity\n        }\n        rewardItems {\n          item {\n            name\n          }\n          quantity\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetItem($name: String) {\n    items(name: $name) {\n      name\n      fleaMarketFee\n      gridImageLink\n      wikiLink\n      buyFor {\n        vendor {\n          name\n        }\n        priceRUB\n      }\n      sellFor {\n        vendor {\n          name\n        }\n        priceRUB\n      }\n      usedInTasks {\n        name\n        minPlayerLevel\n        trader {\n          name\n        }\n        objectives {\n          description\n        }\n        wikiLink\n      }\n      width\n      height\n      changeLast48hPercent\n      bartersUsing {\n        trader {\n          name\n        }\n        level\n        taskUnlock {\n          name\n          wikiLink\n        }\n        requiredItems {\n          item {\n            name\n          }\n          quantity\n        }\n        rewardItems {\n          item {\n            name\n          }\n          quantity\n        }\n      }\n      craftsUsing {\n        station {\n          name\n        }\n        level\n        taskUnlock {\n          name\n          wikiLink\n        }\n        requiredItems {\n          item {\n            name\n          }\n          quantity\n        }\n        rewardItems {\n          item {\n            name\n          }\n          quantity\n        }\n      }\n    }\n  }\n"];

export function gql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;