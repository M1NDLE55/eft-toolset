import { describe, expect, it } from "vitest";
import { customDecodeURI, customEncodeURI } from "@/app/lib/URIEncoding";

describe("route encoding", () => {
  it.each([
    "MP-155 Ultima",
    "A_B-C D",
    "3-(b-TG) stimulant injector",
    "Салewa / 測試",
  ])("round-trips %s without changing punctuation", (name) => {
    expect(customDecodeURI(customEncodeURI(name))).toBe(name);
  });

  it("continues to decode links from the legacy format", () => {
    expect(customDecodeURI("MP_155-Ultima")).toBe("MP-155 Ultima");
  });
});
