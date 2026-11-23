import { createFileRoute } from "@tanstack/react-router";
import { McpPage, MCP_PAGE_METADATA } from "@/app/mcp/mcp-page";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/mcp")({
  staticData: { pageHead: true },
  head: () => pageHead({ page: MCP_PAGE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: McpPage,
});
