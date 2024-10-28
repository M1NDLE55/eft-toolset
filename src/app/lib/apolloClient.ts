import { ApolloClient, InMemoryCache } from "@apollo/client";

export const client = new ApolloClient({
  uri: "https://api.tarkov.dev/graphql",
  cache: new InMemoryCache(),
});

export default client;
