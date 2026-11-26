// @vitest-environment node
import { createDefaultSerovalPlugins, makeSerovalPlugin } from "@tanstack/router-core/ssr/client";
import { fromJSON, toJSONAsync } from "seroval";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { RenderDataUnavailableError, renderDataUnavailableAdapter } from "@/app/lib/render-errors";
import { failedChunkUrl, pageErrorKind } from "@/app/lib/usage/page-error";
import { PAGE_ERROR_KINDS } from "@/app/lib/usage/catalog";

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

  it("gives a kind for whatever was thrown, and crash for anything it doesn't recognise", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const odd: unknown[] = [
      "thrown string",
      "",
      null,
      undefined,
      0,
      42,
      false,
      Symbol("thrown"),
      10n,
      () => undefined,
      {},
      [],
      { message: 404 },
      { message: { text: "nested" } },
      Object.create(null),
      new DOMException("The user aborted a request.", "AbortError"),
      new DOMException("The operation timed out.", "TimeoutError"),
      new DOMException("QuotaExceededError", "QuotaExceededError"),
      new RangeError("Maximum call stack size exceeded"),
      new SyntaxError("Unexpected token '<'"),
      new AggregateError([new TypeError("Failed to fetch")], "All failed"),
      Object.defineProperty({}, "message", { get: () => { throw new Error("getter"); } }),
      revoked.proxy,
      new Proxy({}, { getPrototypeOf: () => { throw new Error("trap"); } }),
    ];
    for (const value of odd) {
      const kind = pageErrorKind(value);
      expect(PAGE_ERROR_KINDS).toContain(kind);
      expect(kind).toBe("crash");
    }
  });

  it("reads errors from another realm and plain objects shaped like errors", () => {
    // An iframe's or worker's errors fail instanceof here but have the same name and message.
    const foreign = (source: string) => runInNewContext(source) as unknown;
    expect(foreign("new TypeError('Failed to fetch')") instanceof TypeError).toBe(false);
    expect(pageErrorKind(foreign("new TypeError('Failed to fetch')"))).toBe("network");
    expect(pageErrorKind(foreign("new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js')"))).toBe("chunk_load");
    expect(pageErrorKind(foreign("new Error('boom')"))).toBe("crash");
    expect(pageErrorKind({ name: "TypeError", message: "Load failed" })).toBe("network");
    expect(pageErrorKind({ name: "Error", message: "Load failed" })).toBe("crash");
    expect(pageErrorKind({ name: "RenderDataUnavailableError", message: "Item page: data is temporarily unavailable." })).toBe("unavailable");
    expect(pageErrorKind("Importing a module script failed.")).toBe("chunk_load");
  });

  it("finds the script a failed dynamic import named", () => {
    expect(failedChunkUrl(new TypeError("Failed to fetch dynamically imported module: https://www.eft-toolset.com/assets/map-canvas-CmQ9CYMk.js"))).toBe(
      "https://www.eft-toolset.com/assets/map-canvas-CmQ9CYMk.js"
    );
    expect(failedChunkUrl(new TypeError("error loading dynamically imported module: https://www.eft-toolset.com/assets/item-0awce2bZ.js"))).toBe(
      "https://www.eft-toolset.com/assets/item-0awce2bZ.js"
    );
    expect(failedChunkUrl(new TypeError("Importing a module script failed."))).toBeNull();
    expect(failedChunkUrl(new Error("Unable to preload CSS for /assets/wght-xKv10YAh.css"))).toBeNull();
    expect(failedChunkUrl(null)).toBeNull();
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
