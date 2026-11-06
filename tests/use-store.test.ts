import { beforeEach, describe, expect, it } from "vitest";
import { readStoreSnapshot } from "@/app/lib/storage/use-store";
import { writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";

const STORE: StoreDefinition<string[]> = {
  key: "test:snapshot",
  version: 1,
  defaultValue: () => [],
  validate: (value): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string"),
};

describe("store snapshots", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns a stable reference until the stored value changes", () => {
    writeStore(STORE, ["a"]);
    const first = readStoreSnapshot(STORE);
    expect(readStoreSnapshot(STORE)).toBe(first);
    writeStore(STORE, ["a", "b"]);
    const second = readStoreSnapshot(STORE);
    expect(second).not.toBe(first);
    expect(second).toEqual(["a", "b"]);
  });
});
