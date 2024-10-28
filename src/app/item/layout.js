"use client";

import SearchItem from "../components/item/search/SearchItem";
import { ApolloProvider } from "@apollo/client";
import client from "../lib/apolloClient";

export default function Layout({ children }) {
  return (
    <main className="flex justify-center p-4 sm:min-h-[calc(100vh-128px)] min-h-[calc(100vh-64px)]">
      <ApolloProvider client={client}>
        <div className="max-w-xl w-full flex flex-col gap-4">
          <SearchItem />
          {children}
        </div>
      </ApolloProvider>
    </main>
  );
}
