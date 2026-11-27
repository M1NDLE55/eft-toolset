import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStaleBuild, pageBuild, recoverFromStaleBuild, resetStaleBuildReloads } from "@/app/lib/stale-build";

// A page from build A whose chunk the site (now on build B) no longer has.
const ENTRY = "/assets/index-AAAAaaaa.js";
const chunkError = (path: string) => new TypeError(`Failed to fetch dynamically imported module: ${location.origin}${path}`);
const safariError = () => new TypeError("Importing a module script failed.");

let script: HTMLScriptElement;
let probe: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
let unregister: ReturnType<typeof vi.fn>;
let deleted: string[];

/** The site answers HEAD requests with `status` for the given paths, 200 for anything else. */
function siteAnswers(statuses: Record<string, number>) {
  probe = vi.fn((input: string, init?: RequestInit) => {
    expect(init).toMatchObject({ method: "HEAD", cache: "no-store" });
    return Promise.resolve(new Response(null, { status: statuses[new URL(input, location.href).pathname] ?? 200 }));
  });
  vi.stubGlobal("fetch", probe);
}

async function settle() {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  script = document.createElement("script");
  script.type = "module";
  script.src = ENTRY;
  document.head.append(script);
  sessionStorage.clear();
  resetStaleBuildReloads();
  reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, origin: window.location.origin, href: window.location.href, reload });
  unregister = vi.fn(() => Promise.resolve(true));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistrations: () => Promise.resolve([{ unregister }]) },
  });
  deleted = [];
  vi.stubGlobal("caches", {
    keys: () => Promise.resolve(["eft-static-v4", "eft-pages-v4-index-AAAAaaaa", "eft-data-v4"]),
    delete: (key: string) => {
      deleted.push(key);
      return Promise.resolve(true);
    },
  });
});

afterEach(() => {
  script.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("an old version's page", () => {
  it("knows its build by the script that started it", () => {
    expect(pageBuild()).toBe(ENTRY);
    script.src = "https://cdn.example/assets/index-elsewhere.js";
    expect(pageBuild()).toBeNull();
  });

  it("is stale when the chunk the browser named is gone from the site", async () => {
    siteAnswers({ "/assets/routes-B5NDp1i5.js": 404 });
    await expect(isStaleBuild(chunkError("/assets/routes-B5NDp1i5.js"))).resolves.toBe(true);
    // Only the named file is asked for, not the entry.
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("isn't stale when the named chunk is still there, or the site doesn't answer", async () => {
    siteAnswers({});
    await expect(isStaleBuild(chunkError("/assets/routes-DJ69Fv2e.js"))).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(isStaleBuild(chunkError("/assets/routes-DJ69Fv2e.js"))).resolves.toBe(false);
  });

  it("asks for its entry script when the browser didn't name the chunk (Safari)", async () => {
    siteAnswers({ [ENTRY]: 404 });
    await expect(isStaleBuild(safariError())).resolves.toBe(true);
    expect(probe).toHaveBeenCalledWith(ENTRY, expect.anything());
  });

  it("asks nothing for other errors, other sites' files, or outside a built page", async () => {
    siteAnswers({});
    await expect(isStaleBuild(new TypeError("Failed to fetch"))).resolves.toBe(false);
    await expect(isStaleBuild(new TypeError("Failed to fetch dynamically imported module: https://cdn.example/assets/a.js"))).resolves.toBe(false);
    script.remove();
    await expect(isStaleBuild(safariError())).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("reloads once onto the current version, past the service worker and its kept pages", async () => {
    siteAnswers({ "/assets/routes-B5NDp1i5.js": 404 });
    const onReload = vi.fn();
    const error = chunkError("/assets/routes-B5NDp1i5.js");
    await expect(recoverFromStaleBuild(error, onReload)).resolves.toBe("reloading");
    // Asked again for the same failure (its error page remounting): the same answer, nothing new.
    await expect(recoverFromStaleBuild(error, onReload)).resolves.toBe("reloading");
    await settle();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual(["eft-pages-v4-index-AAAAaaaa"]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("doesn't reload the same build twice in a tab", async () => {
    siteAnswers({ "/assets/routes-B5NDp1i5.js": 404, "/assets/other-x.js": 404 });
    await recoverFromStaleBuild(chunkError("/assets/routes-B5NDp1i5.js"), () => undefined);
    await settle();
    // After the reload, the page is still this build (a broken deploy, or the old page served again).
    const onReload = vi.fn();
    await expect(recoverFromStaleBuild(chunkError("/assets/other-x.js"), onReload)).resolves.toBe("gone");
    await settle();
    expect(onReload).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);

    // A newer build in the same tab gets its own reload.
    script.src = "/assets/index-BBBBbbbb.js";
    await expect(recoverFromStaleBuild(chunkError("/assets/other-x.js"), onReload)).resolves.toBe("reloading");
  });

  it("keeps the mark in the window's name when storage is blocked", async () => {
    siteAnswers({ "/assets/routes-B5NDp1i5.js": 404 });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await expect(recoverFromStaleBuild(chunkError("/assets/routes-B5NDp1i5.js"), () => undefined)).resolves.toBe("reloading");
    expect(window.name).toBe(`eft:stale-build-reload:${ENTRY}`);
    await expect(recoverFromStaleBuild(chunkError("/assets/routes-B5NDp1i5.js"), () => undefined)).resolves.toBe("gone");
  });

  it("never reloads when no mark could be kept", async () => {
    siteAnswers({ "/assets/routes-B5NDp1i5.js": 404 });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    // A window whose name won't change.
    const name = Object.getOwnPropertyDescriptor(window, "name") ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "name");
    Object.defineProperty(window, "name", { configurable: true, get: () => "", set: () => undefined });
    try {
      await expect(recoverFromStaleBuild(chunkError("/assets/routes-B5NDp1i5.js"), () => undefined)).resolves.toBe("gone");
      await settle();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      if (name) Object.defineProperty(window, "name", name);
      else Reflect.deleteProperty(window, "name");
    }
  });

  it("reloads even if the service worker can't be let go of", async () => {
    siteAnswers({ "/assets/routes-B5NDp1i5.js": 404 });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: () => Promise.reject(new Error("no")) },
    });
    await recoverFromStaleBuild(chunkError("/assets/routes-B5NDp1i5.js"), () => undefined);
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
