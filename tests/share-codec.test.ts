import { describe, expect, it } from "vitest";
import { decodeSharePayload, encodeSharePayload } from "@/app/lib/share-codec";

describe("share payload codec", () => {
  it("round-trips Unicode structured data", async () => {
    const value = { name: "Route 測試", points: [[1.25, -42.5]], note: "Салewa" };
    const encoded = await encodeSharePayload(value);
    await expect(decodeSharePayload(encoded)).resolves.toEqual(value);
  });

  it("rejects oversized and malformed input before parsing", async () => {
    await expect(decodeSharePayload("a".repeat(400_001))).rejects.toThrow(/size/i);
    await expect(decodeSharePayload("j.not+base64")).rejects.toThrow(/encoding/i);
  });
});
