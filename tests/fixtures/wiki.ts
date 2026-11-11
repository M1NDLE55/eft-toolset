import { readFileSync } from "node:fs";
import index from "./wiki/index.json";

// Wiki API responses recorded on 2026-11-11; unrecorded requests fail closed.
export function wikiFixtureResponse(input: string | URL | Request): Response | null {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "escapefromtarkov.fandom.com") return null;
  const params = url.searchParams;
  const key =
    params.get("list") === "search" ? `search:${params.get("srsearch")?.toLowerCase()}` : `page:${params.get("titles")}`;
  const file = (index as Record<string, string>)[key];
  if (!file) return new Response(`No recorded wiki response for ${key}`, { status: 500 });
  return new Response(readFileSync(new URL(`./wiki/${file}`, import.meta.url), "utf8"), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
