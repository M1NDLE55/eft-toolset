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
});
