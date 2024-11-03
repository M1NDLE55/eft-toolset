"use client";

import { ApolloProvider } from "@apollo/client";
import { ReactNode } from "react";
import client from "../lib/apolloClient";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main className="flex justify-center p-4 sm:min-h-[calc(100vh-128px)] min-h-[calc(100vh-64px)]">
      <ApolloProvider client={client}>{children}</ApolloProvider>
    </main>
  );
}
