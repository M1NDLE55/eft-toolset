import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStore,
  subscribeStore,
  writeStore,
  type StoreDefinition,
} from "@/app/lib/storage/versioned-store";

const definition: StoreDefinition<string[]> = {
  key: "test:new",
  legacyKeys: ["test:old"],
  version: 2,
  defaultValue: () => [],
  validate: (value): value is string[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === "string"),
};

describe("versioned local storage", () => {
  beforeEach(() => localStorage.clear());

  it("migrates an unversioned legacy value into an envelope", () => {
    localStorage.setItem("test:old", JSON.stringify(["one"]));
    expect(readStore(definition)).toEqual(["one"]);
    expect(localStorage.getItem("test:old")).toBeNull();
    expect(JSON.parse(localStorage.getItem("test:new")!)).toEqual({
      version: 2,
      data: ["one"],
    });
  });

  it("quarantines invalid data and returns a safe default", () => {
    localStorage.setItem("test:new", "{broken");
    expect(readStore(definition)).toEqual([]);
    expect(localStorage.getItem("test:new")).toBeNull();
    expect(Object.keys(localStorage).some((key) => key.startsWith("test:new:corrupt:"))).toBe(true);
  });

  it("notifies same-tab subscribers after a write", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStore(definition.key, listener);
    writeStore(definition, ["two"]);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("recovers valid records instead of discarding the collection", () => {
    const recoverable: StoreDefinition<string[]> = {
      ...definition,
      recover: (value) =>
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : undefined,
    };
    localStorage.setItem(
      definition.key,
      JSON.stringify({ version: definition.version, data: ["valid", 42] })
    );
    expect(readStore(recoverable)).toEqual(["valid"]);
    expect(JSON.parse(localStorage.getItem(definition.key)!).data).toEqual(["valid"]);
  });

  it("surfaces quota and blocked-storage write failures", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => writeStore(definition, ["value"])).toThrow(/storage may be full/i);
    write.mockRestore();
  });

  it("accepts valid falsy migration results", () => {
    const booleanStore: StoreDefinition<boolean> = {
      key: "test:boolean",
      version: 2,
      defaultValue: () => true,
      validate: (value): value is boolean => typeof value === "boolean",
      migrate: () => false,
    };
    localStorage.setItem(
      booleanStore.key,
      JSON.stringify({ version: 1, data: true })
    );

    expect(readStore(booleanStore)).toBe(false);
  });
});
