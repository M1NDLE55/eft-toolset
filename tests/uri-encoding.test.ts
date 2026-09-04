import { describe, expect, it } from "vitest";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";

describe("route encoding", () => {
  it.each([
    "MP-155 Ultima",
    "A_B-C D",
    "A 100% item with a literal %20 token",
    "3-(b-TG) stimulant injector",
    "Салewa / 測試",
  ])("round-trips %s without changing punctuation", (name) => {
    expect(customDecodeURI(customEncodeURI(name))).toBe(name);
    expect(customDecodeURI(decodeURIComponent(customEncodeURI(name)))).toBe(name);
  });

  it("continues to decode links from the legacy format", () => {
    expect(customDecodeURI("MP_155-Ultima")).toBe("MP-155 Ultima");
  });

  it("returns an empty value for malformed or oversized route components", () => {
    expect(customDecodeURI("%ZZ")).toBe("");
    expect(customDecodeURI("a".repeat(2_049))).toBe("");
  });
});
