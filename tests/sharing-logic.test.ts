// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/app/lib/sharing/sha256";
import {
  applyBuildPatch,
  clashingBuildFields,
  diffBuild,
  foldBuildPatches,
  nextBuildFieldVersions,
  omitBuildFields,
  type BuildContent,
} from "@/app/lib/sharing/build-patch";
import { applyGroupPatch, diffGroup, foldGroupPatches } from "@/app/lib/sharing/group-patch";
import { buildHash, groupHash } from "@/app/lib/sharing/content-hash";
import { createLinkCode, LINK_CODE_LENGTH, parseLinkKeys, verifyLinkCode } from "@/app/lib/sharing/link-code";
import { isRecordId, newRecordId } from "@/app/lib/sharing/ids";

const gun: BuildContent = {
  name: "AK",
  weaponId: "ak",
  root: {
    itemId: "ak",
    slots: {
      mod_gas_block: { itemId: "gas1", slots: { mod_handguard: { itemId: "hg1", slots: {} } } },
      mod_stock: { itemId: "stock1", slots: {} },
    },
  },
};

describe("sha256", () => {
  it("matches Web Crypto for short, block-boundary and multi-byte input", async () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "Ночь в Таркове 🌙"]) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
      expect(sha256Hex(text)).toBe(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    }
  });
});

describe("build patches", () => {
  it("round-trips any change through diff and apply", () => {
    const after: BuildContent = {
      ...gun,
      name: "AK budget",
      ammoId: "ps",
      root: {
        itemId: "ak",
        slots: {
          mod_gas_block: { itemId: "gas2", slots: { mod_handguard: { itemId: "hg2", slots: { mod_foregrip: { itemId: "grip", slots: {} } } } } },
          mod_muzzle: { itemId: "brake", slots: {} },
        },
      },
    };
    const patch = diffBuild(gun, after)!;
    expect(patch.slots).toEqual({
      mod_gas_block: "gas2",
      "mod_gas_block/mod_handguard": "hg2",
      "mod_gas_block/mod_handguard/mod_foregrip": "grip",
      mod_muzzle: "brake",
      mod_stock: null,
    });
    expect(applyBuildPatch(gun, patch)).toEqual(after);
    expect(diffBuild(gun, structuredClone(gun))).toBeNull();
  });

  it("treats a slot as clashing with itself, slots above it and slots below it, but not its siblings", () => {
    const versions = { name: 1, ammo: 1, "slot:mod_gas_block": 1, "slot:mod_gas_block/mod_handguard": 5, "slot:mod_stock": 1 };
    expect(clashingBuildFields({ slots: { mod_gas_block: "gas2" } }, versions, 2)).toEqual(["slot:mod_gas_block"]);
    expect(clashingBuildFields({ slots: { "mod_gas_block/mod_handguard/mod_foregrip": "g" } }, versions, 2)).toHaveLength(1);
    expect(clashingBuildFields({ slots: { mod_stock: "s2" }, name: "x" }, versions, 2)).toEqual([]);
  });

  it("drops field versions of slots below a replaced slot, keeping the map bounded", () => {
    const next = nextBuildFieldVersions({ "slot:mod_gas_block": 1, "slot:mod_gas_block/mod_handguard": 1, "slot:mod_stock": 1 }, { slots: { mod_gas_block: "gas2" } }, 4);
    expect(next).toEqual({ "slot:mod_gas_block": 4, "slot:mod_stock": 1 });
  });

  it("folds queued patches so a later change to a slot replaces what an earlier one mounted below it", () => {
    const folded = foldBuildPatches({ name: "a", slots: { mod_gas_block: "gas2", "mod_gas_block/mod_handguard": "hg2" } }, { slots: { mod_gas_block: "gas3" }, ammoId: null });
    expect(folded).toEqual({ name: "a", ammoId: null, slots: { mod_gas_block: "gas3" } });
    expect(omitBuildFields(folded, ["slot:mod_gas_block", "name"])).toEqual({ ammoId: null });
  });
});

describe("group patches", () => {
  it("diffs, applies and folds add and remove sets", () => {
    const patch = diffGroup({ name: "Keys", items: ["a", "b"] }, { name: "Keys 2", items: ["b", "c"] })!;
    expect(patch).toEqual({ name: "Keys 2", add: ["c"], remove: ["a"] });
    expect(applyGroupPatch({ name: "Keys", items: ["a", "b"] }, patch)).toEqual({ name: "Keys 2", items: ["b", "c"] });
    expect(foldGroupPatches({ add: ["x"] }, { remove: ["x"], add: ["y"] })).toEqual({ add: ["y"], remove: ["x"] });
  });
});

describe("content hashes", () => {
  it("ignore ids, slot order, group name case and item order", () => {
    const reordered = { ...gun, root: { itemId: "ak", slots: { mod_stock: gun.root.slots.mod_stock, mod_gas_block: gun.root.slots.mod_gas_block } } };
    expect(buildHash(reordered)).toBe(buildHash(gun));
    expect(buildHash({ ...gun, ammoId: "bp" })).not.toBe(buildHash(gun));
    expect(groupHash({ name: "Keys", items: ["b", "a"] })).toBe(groupHash({ name: "keys", items: ["a", "b"] }));
  });
});

describe("ids and link codes", () => {
  const keys = parseLinkKeys("1:first-secret-that-is-long-enough-000000", true);

  it("makes 128-bit record ids", () => {
    const id = newRecordId();
    expect(id).toHaveLength(22);
    expect(isRecordId(id)).toBe(true);
    expect(isRecordId("../../etc")).toBe(false);
  });

  it("makes 21-character codes that verify, and rejects forged, mistyped and unknown-version codes", async () => {
    const code = await createLinkCode(keys);
    expect(code).toHaveLength(LINK_CODE_LENGTH);
    expect(await verifyLinkCode(code, keys)).toBe(true);
    const flipped = code.slice(0, 5) + (code[5] === "A" ? "B" : "A") + code.slice(6);
    expect(await verifyLinkCode(flipped, keys)).toBe(false);
    expect(await verifyLinkCode(`2${code.slice(1)}`, keys)).toBe(false);
    expect(await verifyLinkCode("not a code", keys)).toBe(false);
    let forged = 0;
    for (let index = 0; index < 200; index += 1) if (await verifyLinkCode(`1${newRecordId().slice(0, 20)}`, keys)) forged += 1;
    expect(forged).toBe(0);
  });

  it("rotates keys: new codes use the newest key and old codes keep working", async () => {
    const old = await createLinkCode(keys);
    const rotated = parseLinkKeys("1:first-secret-that-is-long-enough-000000,2:second-secret-that-is-long-enough-00000", true);
    const fresh = await createLinkCode(rotated);
    expect(fresh[0]).toBe("2");
    expect(await verifyLinkCode(old, rotated)).toBe(true);
    expect(await verifyLinkCode(fresh, keys)).toBe(false);
  });

  it("refuses weak keys, and has a development key only outside production", () => {
    expect(() => parseLinkKeys("1:short", true)).toThrow();
    expect(parseLinkKeys(undefined, true).size).toBe(0);
    expect(parseLinkKeys(undefined, false).size).toBe(1);
  });
});
