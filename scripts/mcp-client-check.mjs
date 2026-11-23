#!/usr/bin/env node
// Connects real MCP clients to an EFT Toolset MCP endpoint and checks that they can sign in, list
// tools and call them: the SDK v1 client (2025-era Streamable HTTP, as most connectors speak today)
// and the SDK v2 client (the 2026-07-28 revision, negotiated automatically).
//
//   node scripts/mcp-client-check.mjs --url http://127.0.0.1:8787/api/mcp --token <access token>
//
// Without --token it checks that the endpoint challenges for sign-in and that its protected
// resource metadata names the authorization server, which is where a client starts OAuth.

import { parseArgs } from "node:util";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as ClientV2, StreamableHTTPClientTransport as TransportV2 } from "@modelcontextprotocol/client";

const { values: args } = parseArgs({ options: { url: { type: "string" }, token: { type: "string" } } });
if (!args.url) throw new Error("Give --url.");
const url = new URL(args.url);
let failures = 0;

function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}

// Sign-in discovery, as a client does it before it has a token.
const challenge = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } } }),
});
const header = challenge.headers.get("www-authenticate") ?? "";
check("no token: 401 with a resource_metadata challenge", challenge.status === 401 && header.includes("resource_metadata="), `${challenge.status} ${header}`);
const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
if (metadataUrl) {
  // The challenge names the canonical URL; ask this server for the same path.
  const local = new URL(new URL(metadataUrl).pathname, url);
  const metadata = await (await fetch(local)).json();
  check("protected resource metadata names the AuthKit issuer", Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length === 1, JSON.stringify(metadata.authorization_servers));
}

if (args.token) {
  const requestInit = { headers: { authorization: `Bearer ${args.token}` } };
  for (const [label, Client, Transport] of [
    ["SDK v1 client (2025-06-18)", ClientV1, TransportV1],
    ["SDK v2 client (negotiated)", ClientV2, TransportV2],
  ]) {
    const client = new Client({ name: "eft-toolset-check", version: "1.0.0" });
    try {
      await client.connect(new Transport(url, { requestInit }));
      const info = client.getServerVersion?.();
      check(`${label}: connects`, true, info ? `${info.name} ${info.version}` : "");
      const { tools } = await client.listTools();
      check(`${label}: lists tools`, tools.length >= 19, `${tools.length} tools`);
      const result = await client.callTool({ name: "search_items", arguments: { query: "salewa", limit: 1 } });
      const found = result.structuredContent?.results?.[0]?.name;
      check(`${label}: calls a tool`, !result.isError && found === "Salewa first aid kit", found ?? JSON.stringify(result).slice(0, 200));
      const wiki = await client.callTool({ name: "get_wiki_page", arguments: { page: "Reshala" } });
      check(`${label}: reads the wiki snapshot`, !wiki.isError, wiki.structuredContent?.title ?? JSON.stringify(wiki).slice(0, 200));
    } catch (error) {
      check(`${label}`, false, error instanceof Error ? error.message : String(error));
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

process.exitCode = failures ? 1 : 0;
