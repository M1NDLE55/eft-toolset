import { GetItemQuery } from "@/__generated__/graphql";

type ArrayElement<T> = T extends { items: (infer U)[] } ? U : never;

export type Item = NonNullable<ArrayElement<GetItemQuery>>;
