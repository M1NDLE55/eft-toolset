// @vitest-environment node
import { createDefaultSerovalPlugins, makeSerovalPlugin } from "@tanstack/router-core/ssr/client";
import { fromJSON, toJSONAsync } from "seroval";
import { describe, expect, it } from "vitest";
import { RenderDataUnavailableError, renderDataUnavailableAdapter } from "@/app/lib/render-errors";
import { pageErrorKind } from "@/app/lib/usage/page-error";

describe("page error kinds", () => {
  it("tells data that wasn't ready from a broken page", () => {
    expect(pageErrorKind(new RenderDataUnavailableError("Item page"))).toBe("unavailable");
    expect(pageErrorKind(new TypeError("e.buyFor.filter(...).toSorted is not a function"))).toBe("crash");
    expect(pageErrorKind(new Error("Item page: data is temporarily unavailable."))).toBe("crash");
    expect(pageErrorKind("thrown string")).toBe("crash");
    expect(pageErrorKind(undefined)).toBe("crash");
  });

  it("knows each browser's words for a chunk that didn't download", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://www.eft-toolset.com/assets/map-canvas-CmQ9CYMk.js",
      "error loading dynamically imported module: https://www.eft-toolset.com/assets/item-0awce2bZ.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/wght-xKv10YAh.css",
    ]) {
      expect(pageErrorKind(new TypeError(message))).toBe("chunk_load");
    }
  });

  it("counts fetch's own failures as network errors, and only those", () => {
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(pageErrorKind(new TypeError(message))).toBe("network");
    }
    expect(pageErrorKind(new Error("Failed to fetch"))).toBe("crash");
  });
});

type Plugins = NonNullable<Parameters<typeof toJSONAsync>[1]>["plugins"];

describe("sending a render error to the browser", () => {
  const roundTrip = async (value: unknown, plugins: Plugins) => fromJSON(await toJSONAsync(value, { plugins }), { plugins });

  it("keeps the error's type with the adapter, where TanStack would otherwise send only its message", async () => {
    const plain = (await roundTrip({ error: new RenderDataUnavailableError("Item page") }, createDefaultSerovalPlugins())) as { error: Error };
    expect(plain.error).not.toBeInstanceOf(RenderDataUnavailableError);
    expect(plain.error.message).toBe("Item page: data is temporarily unavailable.");

    const plugins = [makeSerovalPlugin(renderDataUnavailableAdapter), ...createDefaultSerovalPlugins()];
    const kept = (await roundTrip({ error: new RenderDataUnavailableError("Item page") }, plugins)) as { error: RenderDataUnavailableError };
    expect(kept.error).toBeInstanceOf(RenderDataUnavailableError);
    expect(kept.error.label).toBe("Item page");
    expect(kept.error.message).toBe("Item page: data is temporarily unavailable.");
    expect(pageErrorKind(kept.error)).toBe("unavailable");

    // Other errors are untouched: still a plain Error with their message.
    const other = (await roundTrip({ error: new TypeError("boom") }, plugins)) as { error: Error };
    expect(other.error).not.toBeInstanceOf(RenderDataUnavailableError);
    expect(other.error.message).toBe("boom");
  });
});
