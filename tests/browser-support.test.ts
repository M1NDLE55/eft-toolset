import { describe, expect, it } from "vitest";
import { findTooNewApis } from "../scripts/browser-support.mjs";

const apis = (code: string, moduleId?: string) => findTooNewApis(code, moduleId).map((found) => found.api);

describe("findTooNewApis", () => {
  it("finds array copy methods Chrome 109 lacks, minified or not", () => {
    expect(apis("const a = items.toSorted((x, y) => x - y);")).toEqual([".toSorted()"]);
    expect(apis("let t=e.toReversed();n=r?.with(1,o)")).toEqual([".toReversed()", ".with()"]);
  });

  it("finds static built-ins by their global", () => {
    expect(apis("const g = Object.groupBy(list, key);")).toEqual(["Object.groupBy"]);
    expect(apis("let{promise:p}=Promise.withResolvers()")).toEqual(["Promise.withResolvers"]);
    expect(apis("const f = Iterator.from(source);")).toEqual(["Iterator.from"]);
  });

  it("finds Set methods called on an instance", () => {
    expect(apis("a.union(b);c.isSubsetOf(d)")).toEqual([".union()", ".isSubsetOf()"]);
  });

  it("leaves supported and look-alike code alone", () => {
    expect(apis("[...items].sort((a, b) => a - b); items.slice().reverse(); items.findLast(Boolean); items.at(-1)")).toEqual([]);
    expect(apis("const sortedItems = 1; withdraw(); myObject.groupBy(x); new URL(text); JSON.parse(text)")).toEqual([]);
    expect(apis("// OrderedDict.toSorted requires a compare function")).toEqual([]);
  });

  it("skips calls the allowed dependencies make safely", () => {
    const radix = "/app/node_modules/@radix-ui/react-collection/dist/index.mjs";
    expect(apis("const sorted = map.toSorted(byPosition);", radix)).toEqual([]);
    expect(apis("const sorted = map.toSorted(byPosition); list.with(0, x);", radix)).toEqual([".with()"]);
  });
});
