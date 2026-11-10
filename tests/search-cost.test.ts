import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "@/app/lib/cache/types";
import { FuzzyBudget, searchCatalog, suggestNames } from "@/app/lib/search/filter-catalog";
import { indexCatalog, matchItemReference } from "@/app/lib/search/item-reference";

// A catalogue the size of tarkov.dev's (about 5,000 items, 4,000 distinct words), from a
// seeded generator so every run sees the same names.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

const random = seeded(7);
const letters = "abcdefghijklmnopqrstuvwxyz";
const word = (length: number) => Array.from({ length }, () => letters[Math.floor(random() * 26)]).join("");
const vocabulary = Array.from({ length: 4_000 }, () => word(3 + Math.floor(random() * 9)));
const entries: CatalogEntry[] = Array.from({ length: 5_000 }, (_, index) => {
  const words = Array.from({ length: 2 + Math.floor(random() * 6) }, () => vocabulary[Math.floor(random() * vocabulary.length)]);
  const name = `${words.join(" ")} ${index}`;
  return [`id-${index}`, name, words[0], null, `slug-${index}`];
});
const index = indexCatalog(entries);

/** A 500-character name of five-letter words from the common letters, as an attacker would send. */
function nonsense(seed: number) {
  const next = seeded(seed);
  const words: string[] = [];
  while (words.join(" ").length < 490) {
    words.push(Array.from({ length: 5 }, () => "aeiorstnl"[Math.floor(next() * 9)]).join(""));
  }
  return words.join(" ");
}

function elapsed(work: () => void) {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe("name resolution cost", () => {
  // Warm the index and caches so timings measure lookups, not setup.
  matchItemReference(index, "warm up the index");

  // Before the word index, one such name took about 400 ms and 100 took 40 s. The limits are
  // ten times what the bounded search needs on a slow machine.
  it("resolves a long nonsense name quickly", () => {
    const time = elapsed(() => expect(matchItemReference(index, nonsense(1)).status).toBe("none"));
    expect(time).toBeLessThan(100);
  });

  it("resolves a hundred long nonsense names in well under a second", () => {
    const time = elapsed(() => {
      for (let seed = 2; seed < 102; seed++) matchItemReference(index, nonsense(seed));
    });
    expect(time).toBeLessThan(2_000);
  });

  it("keeps a repeated word from multiplying the work", () => {
    const time = elapsed(() => matchItemReference(index, "e ".repeat(250)));
    expect(time).toBeLessThan(100);
  });

  it("still finds a typo and suggests names after the speed-up", () => {
    const [, name] = entries[42];
    const words = name.split(" ");
    const target = words.find((candidate) => candidate.length >= 8)!;
    const typo = name.replace(target, `${target.slice(0, 2)}${target[3]}${target[2]}${target.slice(4)}`);
    const match = matchItemReference(index, typo);
    expect(match).toMatchObject({ status: "found", matchedBy: "fuzzy" });
    expect(match.status === "found" && match.item.name).toBe(name);
    expect(suggestNames(index.items, `${target} zzzzqqqq`)).toContain(name);
  });

  it("stops typo matching and suggestions once a request's budget is spent", () => {
    const budget = new FuzzyBudget(2);
    expect(searchCatalog(index.items, "qqqqqqqq", { fuzzy: true, budget }).skipped).toBeUndefined();
    expect(suggestNames(index.items, `${vocabulary[0]}x`, 5, budget).length).toBeGreaterThan(0);
    expect(searchCatalog(index.items, "qqqqqqqq", { fuzzy: true, budget }).skipped).toBe(true);
    expect(suggestNames(index.items, `${vocabulary[0]}x`, 5, budget)).toEqual([]);
    expect(matchItemReference(index, nonsense(500), { budget })).toEqual({ status: "none", suggestions: [], skipped: true });
  });
});
