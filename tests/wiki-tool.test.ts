// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { MAX_WIKI_CONTENT_CHARS } from "@/app/lib/mcp/wiki";
import { setWikiSnapshotDirectory } from "@/app/lib/wiki/snapshot";
import { writeFixtureSnapshot } from "./fixtures/wiki";

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

const MARKUP = /\[\[|\]\]|\{\{|\}\}|'''|<\/?[a-z]|File:|\{\||\|-\|/;

beforeAll(() => setWikiSnapshotDirectory(writeFixtureSnapshot()));

beforeEach(() => {
  resetRequestBudgets();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  // The snapshot is local: any request is a bug.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("get_wiki_page must not make requests"));
});

describe("get_wiki_page", () => {
  it("starts a long page with its infobox and introduction, lists its sections, and credits the adapted dump", async () => {
    const { isError, data } = await readWiki({ page: "Killa" });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      found: true,
      title: "Killa",
      url: "https://escapefromtarkov.fandom.com/wiki/Killa",
      revisionId: 362459,
      lastEdited: "2026-09-29T15:33:26Z",
      content: "faction: Scavs\nfull name: Unknown\nlocation: Interchange, Terminal\n\nKilla is a Scav Boss in Escape from Tarkov.",
      note: "This is the start of the page. Ask for sections by heading for the rest.",
    });
    expect(data.sections).toContainEqual({ heading: "Strategy", level: 2, chars: expect.any(Number) });
    expect(data.credit).toBe(
      'From "Killa" on the Escape from Tarkov Wiki (https://escapefromtarkov.fandom.com/wiki/Killa) by its contributors (https://escapefromtarkov.fandom.com/wiki/Killa?action=history), CC BY-NC-SA (https://www.fandom.com/licensing). Adapted: converted to plain text from the wiki\'s 2026-09-29 database dump. Non-commercial use only.'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns only the sections asked for, each with its subsections, matching headings loosely", async () => {
    const strategy = await readWiki({ page: "Killa", sections: ["strategy"] });
    expect(strategy.data.content).toMatch(/^## Strategy\nIt is recommended to avoid being spotted by Killa\./);
    expect(strategy.data.content).not.toContain("## Behavior");
    expect(strategy.data.content).not.toMatch(MARKUP);

    const location = await readWiki({ page: "Killa", sections: ["Location"] });
    expect(location.data.content).toMatch(/^## Location\n[\s\S]*#### Interchange\n[\s\S]*#### Terminal\n/);

    const extracts = await readWiki({ page: "Customs", sections: ["extracts"] });
    expect(extracts.data.content).toMatch(/^## Extractions\nTo locate the extractions/);
    expect(extracts.data.content).toContain("| Dorms V-Ex | PMC | no | yes | 5000 Roubles per player; Maximum of 4 players |");
    expect(extracts.data.content).not.toContain("## Trivia");
  });

  it("returns a short page whole, and reads a quest guide and a boss's strategy", async () => {
    const whole = await readWiki({ page: "Chemical - Part 2" });
    expect(whole.data.note).toBeUndefined();
    expect(whole.data.content).toMatch(/^location: Customs\ngiven by: Skier\n/);
    expect(whole.data.content).toContain("## Dialogue");
    expect(whole.data.content).toContain("## Guide");

    const quest = await readWiki({ page: "Chemical - Part 2", sections: ["Objectives", "Guide"] });
    expect(quest.data.content).toContain("Hand over the evidence to Skier");
    expect(quest.data.content).toContain("They can be found in room 220 on the second floor of the three-story dorms building.");
    expect(quest.data.content).not.toContain("## Dialogue");

    const tagilla = await readWiki({ page: "Tagilla", sections: ["Strategy"] });
    expect(tagilla.data.content).toContain("## Strategy\nIf you are using high penetrating ammunition, aim for his head");
  });

  it("reads the section a wiki link or a redirect points at", async () => {
    const { data } = await readWiki({ page: "https://escapefromtarkov.fandom.com/wiki/Customs#Extractions" });
    expect(data.title).toBe("Customs");
    expect(data.content).toMatch(/^## Extractions\n/);
    expect((await readWiki({ page: "Customs#Extractions" })).data.content).toBe(data.content);

    const redirect = await readWiki({ page: "Air Filtering Unit" });
    expect(redirect.data).toMatchObject({ found: true, title: "Hideout", redirectedFrom: "Air Filtering Unit" });
    expect(redirect.data.content).toMatch(/^## Modules\n/);
  });

  it("follows redirects, and finds titles that differ only in case and punctuation", async () => {
    expect((await readWiki({ page: "Labs" })).data).toMatchObject({ found: true, title: "The Lab", redirectedFrom: "Labs" });
    expect((await readWiki({ page: "tagila" })).data).toMatchObject({ title: "Tagilla", redirectedFrom: "Tagila" });
    expect((await readWiki({ page: "Chemical Part 2" })).data).toMatchObject({
      found: true,
      title: "Chemical - Part 2",
      matchedBy: "search",
    });
  });

  it("says which requested sections don't exist instead of returning the whole page", async () => {
    const { data } = await readWiki({ page: "Killa", sections: ["Spawn chance", "Notes"] });
    expect(data.missingSections).toEqual(["Spawn chance"]);
    expect(data.note).toContain('No section matches "Spawn chance"');
    expect(data.content).toMatch(/^## Notes\n/);
    expect(data.content).not.toContain("## Strategy");
  });

  it("cuts a long section at a line break and points to the rest", async () => {
    const { data } = await readWiki({ page: "Hideout", sections: ["Modules"] });
    expect(data.truncated).toBe(true);
    expect(data.content!.length).toBeLessThanOrEqual(MAX_WIKI_CONTENT_CHARS);
    expect(data.content!.length).toBeGreaterThan(MAX_WIKI_CONTENT_CHARS / 2);
    expect(data.note).toBe('Content was cut at 12,000 characters, in "Modules". Ask for later sections by heading.');
  });

  it("on a miss, returns candidates from the snapshot without guessing", async () => {
    const { isError, data } = await readWiki({ page: "customs extracts" });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      found: false,
      candidates: [{ title: "Customs", url: "https://escapefromtarkov.fandom.com/wiki/Customs", lastEdited: "2026-08-21T18:48:06Z" }],
      note: 'No page is titled "customs extracts". Call again with one of the candidate titles.',
    });
    expect(data.content).toBeUndefined();
    expect(data.credit).toBe(
      "Titles from the Escape from Tarkov Wiki (https://escapefromtarkov.fandom.com), CC BY-NC-SA (https://www.fandom.com/licensing), as of its 2026-09-29 database dump."
    );

    const nothing = await readWiki({ page: "zzqx qqzx" });
    expect(nothing.data).toMatchObject({ found: false, candidates: [], note: 'Nothing in the wiki snapshot matches "zzqx qqzx". Try other words.' });
  });

  it("on a page the snapshot leaves out, points to the tool that covers it", async () => {
    expect((await readWiki({ page: "Salewa first aid kit" })).data.note).toBe(
      '"Salewa first aid kit" is an item page, which the wiki snapshot leaves out: use search_items and get_item.'
    );
    expect((await readWiki({ page: ".300 AP" })).data.note).toContain("use get_ammo_options, or search_items and get_item");
    expect((await readWiki({ page: "Colt M1911A1 .45 ACP pistol" })).data.note).toContain("use get_weapon for a gun");
    expect((await readWiki({ page: "blackout ap" })).data.note).toBe(
      '"blackout ap" matches ".300 Blackout AP", an ammunition page, which the wiki snapshot leaves out: use get_ammo_options, or search_items and get_item.'
    );
    expect((await readWiki({ page: "https://escapefromtarkov.fandom.com/wiki/A_Key_to_Salvation" })).data).toMatchObject({
      found: false,
      note: '"A Key to Salvation" is about something removed from the game, which the wiki snapshot leaves out.',
    });
  });

  it("refuses links to other sites", async () => {
    const { isError, text } = await readWiki({ page: "https://example.com/wiki/Tagilla" });
    expect(isError).toBe(true);
    expect(text).toBe("Only https://escapefromtarkov.fandom.com/wiki/ pages can be read. Pass a page title or search text instead.");
  });
});
