// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importChunk } from "@/app/lib/chunk-load";

// The browser keeps a failed dynamic import's failure, so the second try asks for the script by a new
// URL. Here a file URL stands in for the site's script.
let dir: string;
let scriptUrl: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "chunk-load-"));
  const file = join(dir, "map-canvas-CmQ9CYMk.js");
  await writeFile(file, "export const MapCanvas = 'fresh copy';\n");
  scriptUrl = pathToFileURL(file).href;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const chunkError = (url: string) => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

describe("loading a code chunk", () => {
  it("returns the module when it loads", async () => {
    const load = vi.fn().mockResolvedValue({ MapCanvas: "first try" });
    await expect(importChunk(load)).resolves.toEqual({ MapCanvas: "first try" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks for the failed script again by a new URL", async () => {
    const load = vi.fn().mockRejectedValue(chunkError(scriptUrl));
    const module = (await importChunk(load)) as { MapCanvas: string };
    expect(module.MapCanvas).toBe("fresh copy");
    // Not the import again: the browser would answer it with the kept failure.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("runs the import again when the browser didn't name the script", async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Importing a module script failed.")).mockResolvedValue({ MapCanvas: "second try" });
    await expect(importChunk(load)).resolves.toEqual({ MapCanvas: "second try" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second try", async () => {
    const error = new TypeError("Importing a module script failed.");
    const load = vi.fn().mockRejectedValue(error);
    await expect(importChunk(load)).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry an error that isn't a download failure", async () => {
    const error = new TypeError("L.map is not a function");
    const load = vi.fn().mockRejectedValue(error);
    await expect(importChunk(load)).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("starts with the fresh request for a Retry after a failure", async () => {
    const load = vi.fn().mockResolvedValue({ MapCanvas: "kept failure" });
    const module = (await importChunk(load, { retry: chunkError(scriptUrl) })) as { MapCanvas: string };
    expect(module.MapCanvas).toBe("fresh copy");
    expect(load).not.toHaveBeenCalled();
  });
});
