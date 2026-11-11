// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { MAX_WIKI_CONTENT_CHARS } from "@/app/lib/mcp/wiki";
import { clearWikiCache } from "@/app/lib/wiki/fandom";
import { wikiFixtureResponse } from "./fixtures/wiki";

interface WikiResult {
  found: boolean;
  title?: string;
  url?: string;
  lastEdited?: string;
  revisionId?: number;
  redirectedFrom?: string;
  matchedBy?: string;
  sections?: { heading: string; level: number; chars: number }[];
  missingSections?: string[];
  content?: string;
  truncated?: boolean;
  candidates?: { title: string; url: string; lastEdited: string | null }[];
  note?: string;
  credit: string;
}

let requestId = 0;

async function readWiki(args: Record<string, unknown>) {
  requestId += 1;
  const response = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name: "get_wiki_page", arguments: args },
      }),
    })
  );
  const result = (await response.json()).result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: WikiResult;
  };
  return { isError: result.isError ?? false, text: result.content[0].text, data: result.structuredContent! };
}

const fetchMock = () => vi.mocked(globalThis.fetch);

beforeEach(() => {
  clearWikiCache();
  resetRequestBudgets();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    return wikiFixtureResponse(input as string) ?? new Response("unexpected request", { status: 500 });
  });
});

describe("get_wiki_page", () => {
  it("reads a boss page as plain text with its sections, revision, and credit", async () => {
    const { isError, data } = await readWiki({ page: "Tagilla" });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      found: true,
      title: "Tagilla",
      url: "https://escapefromtarkov.fandom.com/wiki/Tagilla",
      revisionId: 367685,
    });
    expect(data.lastEdited).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.sections).toContainEqual(expect.objectContaining({ heading: "Strategy", level: 2 }));
    expect(data.content).toContain("faction: Scavs\nfull name: Unknown\nlocation: Factory, Interchange, Terminal");
    expect(data.content).toContain("| Head: 100; Thorax: 320; Stomach: 260; Arms: 130 each; Legs: 140 each; Total: 1220 |");
    expect(data.content).toContain("Face cover:\n| Face cover | Armor Class |");
    expect(data.content).toContain(
      "| Saiga-12K 12ga automatic shotgun | 12/70 8.5mm Magnum buckshot, 12/70 AP-20 armor-piercing slug,"
    );
    expect(data.content).toContain("## Strategy\nIf you are using high penetrating ammunition, aim for his head");
    expect(data.content).not.toMatch(/\[\[|\]\]|\{\{|\}\}|'''|<\w|File:|\{\||\|-\|/);
    expect(data.truncated).toBeUndefined();
    expect(data.credit).toBe(
      'From "Tagilla" on the Escape from Tarkov Wiki (https://escapefromtarkov.fandom.com/wiki/Tagilla) by its contributors (https://escapefromtarkov.fandom.com/wiki/Tagilla?action=history), CC BY-NC-SA (https://www.fandom.com/licensing); converted to plain text. Non-commercial use only.'
    );
  });

  it("returns only the sections asked for, each with its subsections, matching headings loosely", async () => {
    const extracts = await readWiki({ page: "Customs", sections: ["extracts"] });
    expect(extracts.data.content).toMatch(/^## Extractions\nTo locate the extractions/);
    expect(extracts.data.content).toContain(
      "| ZB-1013 | PMC | yes | no | Activate lever in warehouse #4 at the crane yard.; +; ZB-1013 key; Used to open the door"
    );
    expect(extracts.data.content).not.toContain("## Trivia");
    const bosses = await readWiki({ page: "Customs", sections: ["Bosses"] });
    expect(bosses.data.content).toContain("## Bosses\n| Name | Location | Notable equipment | Followers |\n| Reshala | At the dorms area;");
    expect(extracts.data.content).not.toContain("enemies:");
    expect(extracts.data.sections?.map((section) => section.heading)).toContain("Trivia");

    const location = await readWiki({ page: "Tagilla", sections: ["Location", "STRATEGY"] });
    expect(location.data.content).toContain("## Location\nTagilla can be found on the following locations:\n\n#### Factory");
    expect(location.data.content).toContain("#### Terminal\nIn the medium container ship berths area.");
    expect(location.data.content).toContain("## Strategy");
    expect(location.data.content).not.toContain("## Behavior");

    const introduction = await readWiki({ page: "Customs", sections: ["Introduction"] });
    expect(introduction.data.content).toMatch(/^prev: Interchange/);
    expect(introduction.data.content).toContain("It is the second map that was added to the game.");
    expect(introduction.data.content).not.toContain("##");
  });

  it("reads the section a wiki link points at, as tarkov.dev's wikiLink gives it", async () => {
    const { data } = await readWiki({ page: "https://escapefromtarkov.fandom.com/wiki/Customs#Extractions" });
    expect(data.title).toBe("Customs");
    expect(data.content).toMatch(/^## Extractions\n/);
    const plain = await readWiki({ page: "Customs#Extractions" });
    expect(plain.data.content).toBe(data.content);
  });

  it("says which requested sections don't exist instead of returning the whole page", async () => {
    const { data } = await readWiki({ page: "Tagilla", sections: ["Spawn chance", "Notes"] });
    expect(data.missingSections).toEqual(["Spawn chance"]);
    expect(data.note).toContain('No section matches "Spawn chance"');
    expect(data.content).toMatch(/^## Notes\n/);
    expect(data.content).not.toContain("## Strategy");
  });

  it("reads a quest guide", async () => {
    const { data } = await readWiki({ page: "Chemical - Part 2", sections: ["Objectives", "Guide"] });
    expect(data.content).toContain("- Hand over the evidence to Skier");
    expect(data.content).toContain("They can be found in room 220 on the second floor of the three-story dorms building.");
  });

  it("opens the page a search finds when only case and punctuation differ from its title", async () => {
    const { data } = await readWiki({ page: "Chemical Part 2" });
    expect(data).toMatchObject({ found: true, title: "Chemical - Part 2", matchedBy: "search" });
  });

  it("returns candidates when no page has the title, without guessing", async () => {
    const { isError, data } = await readWiki({ page: "customs extracts" });
    expect(isError).toBe(false);
    expect(data.found).toBe(false);
    expect(data.content).toBeUndefined();
    expect(data.candidates?.slice(0, 2)).toEqual([
      { title: "Customs", url: "https://escapefromtarkov.fandom.com/wiki/Customs", lastEdited: expect.any(String) },
      {
        title: "Customs plan map",
        url: "https://escapefromtarkov.fandom.com/wiki/Customs_plan_map",
        lastEdited: expect.any(String),
      },
    ]);
    expect(data.note).toBe('No page is titled "customs extracts". Call again with one of the candidate titles.');
    expect(data.credit).toContain("CC BY-NC-SA");

    const nothing = await readWiki({ page: "zzqx qqzx" });
    expect(nothing.data).toMatchObject({ found: false, candidates: [] });
    expect(nothing.data.note).toContain("Nothing on the wiki matches");
  });

  it("follows redirects and says where it came from", async () => {
    const { data } = await readWiki({ page: "Labs" });
    expect(data).toMatchObject({ found: true, title: "The Lab", redirectedFrom: "Labs" });
  });

  it("cuts a long page at a line break and points to its sections", async () => {
    const { data } = await readWiki({ page: "Hideout" });
    expect(data.truncated).toBe(true);
    expect(data.content!.length).toBeLessThanOrEqual(MAX_WIKI_CONTENT_CHARS);
    expect(data.content!.length).toBeGreaterThan(MAX_WIKI_CONTENT_CHARS / 2);
    expect(data.note).toMatch(/Content was cut at 12,000 characters, in "Modules"\. Ask for later sections by heading\./);
    expect(data.sections?.map((section) => section.heading)).toEqual(
      expect.arrayContaining(["Modules", "Cultist Circle", "Unique Sacrifices", "Customization"])
    );

    const section = await readWiki({ page: "Hideout", sections: ["Cultist Circle"] });
    expect(section.data.truncated).toBeUndefined();
    expect(section.data.content).toMatch(/^### Cultist Circle\n/);
    expect(section.data.content).toContain("##### Unique Sacrifices");
  });

  it("caches pages, so asking again doesn't reach the wiki", async () => {
    await readWiki({ page: "Tagilla" });
    await readWiki({ page: "Tagilla", sections: ["Strategy"] });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/escapefromtarkov\.fandom\.com\/api\.php\?/);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^EFT-Toolset\//);
  });

  it("refuses links to other sites", async () => {
    const { isError, text } = await readWiki({ page: "https://example.com/wiki/Tagilla" });
    expect(isError).toBe(true);
    expect(text).toBe(
      "Only https://escapefromtarkov.fandom.com/wiki/ pages can be read. Pass a page title or search text instead."
    );
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("reports a blocked or failing wiki as a tool error the model can relay", async () => {
    const challenge = "<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>";
    fetchMock().mockResolvedValueOnce(new Response(challenge, { status: 403, headers: { "Content-Type": "text/html" } }));
    const blocked = await readWiki({ page: "Tagilla" });
    expect(blocked).toMatchObject({
      isError: true,
      text: "The Escape from Tarkov Wiki is unavailable right now (HTTP 403).",
    });

    fetchMock().mockResolvedValueOnce(new Response(challenge, { status: 200, headers: { "Content-Type": "text/html" } }));
    expect((await readWiki({ page: "Tagilla" })).text).toBe(
      "The Escape from Tarkov Wiki refused the request. Try again later."
    );

    fetchMock().mockResolvedValueOnce(Response.json({ error: { code: "ratelimited", info: "Slow down" } }));
    expect((await readWiki({ page: "Tagilla" })).text).toBe(
      "The Escape from Tarkov Wiki rejected the request. Try again later."
    );

    fetchMock().mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await readWiki({ page: "Tagilla" })).text).toBe(
      "The Escape from Tarkov Wiki didn't answer. Try again in a few seconds."
    );

    expect((await readWiki({ page: "Tagilla" })).data.title).toBe("Tagilla");
  });
});
