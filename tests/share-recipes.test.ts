import { describe, expect, it } from "vitest";
import { encodeSharePayload } from "@/app/lib/share-codec";
import { decodeBuildSharePayload } from "@/app/lib/builds/share";
import { decodePlanSharePayload } from "@/app/lib/raid-planner/share";

describe("shared recipe validation", () => {
  it("rejects a build whose root does not match its weapon", async () => {
    const payload = await encodeSharePayload({ v: 1, w: "weapon", r: ["different"] });
    await expect(decodeBuildSharePayload(payload)).rejects.toThrow(/tree is invalid/i);
  });

  it("rejects duplicate build slot identifiers", async () => {
    const payload = await encodeSharePayload({
      v: 1,
      w: "weapon",
      r: ["weapon", [["slot", ["a"]], ["slot", ["b"]]]],
    });
    await expect(decodeBuildSharePayload(payload)).rejects.toThrow(/tree is invalid/i);
  });

  it("rejects unsupported drawing colors and non-finite coordinates", async () => {
    const badColor = await encodeSharePayload({
      v: 1,
      m: "customs",
      d: [["pen", "javascript:alert(1)", [[0, 0], [1, 1]]]],
    });
    await expect(decodePlanSharePayload(badColor)).rejects.toThrow(/drawings are invalid/i);

    const badPoint = await encodeSharePayload({ v: 1, m: "customs", r: [[1e20, 0]] });
    await expect(decodePlanSharePayload(badPoint)).rejects.toThrow(/route is invalid/i);
  });
});
