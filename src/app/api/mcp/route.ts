import { handleMcpPost, mcpMethodNotAllowed, mcpPreflight } from "@/app/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(request: Request) {
  return handleMcpPost(request);
}

export function GET(request: Request) {
  return mcpMethodNotAllowed(request);
}

export function DELETE(request: Request) {
  return mcpMethodNotAllowed(request);
}

export function OPTIONS(request: Request) {
  return mcpPreflight(request);
}
