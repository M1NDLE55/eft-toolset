"use client";

import SearchItem from "../components/item/search/search-item";
import { ApolloProvider } from "@apollo/client";
import client from "../lib/apolloClient";
import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
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
