import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentScaleSync } from "@/app/components/global/content-scale";
import { ContentScaleSetting } from "@/app/components/settings/content-scale-setting";
import {
  applyContentScale,
  CONTENT_SCALE_PROPERTY,
  CONTENT_SCALE_STORE,
  contentScalePercent,
  contentScaleScript,
  DEFAULT_CONTENT_SCALE,
} from "@/app/lib/settings/content-scale";
import { setContentScale } from "@/app/lib/settings/store";
import { BACKUP_STORES, createBackup, parseBackup, applyRestore } from "@/app/lib/storage/backup";
import { readStore } from "@/app/lib/storage/versioned-store";

const root = document.documentElement;
const applied = () => root.style.getPropertyValue(CONTENT_SCALE_PROPERTY);
const runScript = () => new Function(contentScaleScript())();
const save = (data: unknown, version = 1) =>
  window.localStorage.setItem(CONTENT_SCALE_STORE.key, JSON.stringify({ version, data }));

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  root.removeAttribute("style");
});

afterEach(() => {
  document.body.innerHTML = "";
  root.removeAttribute("style");
});

describe("content size setting", () => {
  it("defaults to 125%, for new and existing visitors alike", () => {
    expect(DEFAULT_CONTENT_SCALE).toBe(125);
    expect(readStore(CONTENT_SCALE_STORE)).toBe("default");
    expect(contentScalePercent("default")).toBe(125);
  });

  it("matches the stylesheet default, which applies when nothing is saved", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const declared = css.match(/:root\s*\{[^}]*--content-scale:\s*([\d.]+)/)?.[1];
    expect(Number(declared)).toBe(DEFAULT_CONTENT_SCALE / 100);
  });

  it("persists a chosen size and falls back to the default for an unknown one", () => {
    setContentScale(150);
    expect(readStore(CONTENT_SCALE_STORE)).toBe(150);
    save(175);
    expect(readStore(CONTENT_SCALE_STORE)).toBe("default");
  });

  it("is part of the backup and restores", () => {
    expect(BACKUP_STORES.some((store) => store.definition.key === CONTENT_SCALE_STORE.key)).toBe(true);
    setContentScale(112.5);
    const backup = JSON.stringify(createBackup());
    window.localStorage.clear();
    applyRestore(parseBackup(backup), "replace");
    expect(readStore(CONTENT_SCALE_STORE)).toBe(112.5);
  });

  it("sets the size on <html>, or clears it for the default", () => {
    applyContentScale(root, 137.5);
    expect(applied()).toBe("1.375");
    applyContentScale(root, "default");
    expect(applied()).toBe("");
  });
});

describe("content size before first paint", () => {
  it("applies a saved size", () => {
    setContentScale(150);
    runScript();
    expect(applied()).toBe("1.5");
  });

  it("applies a bare saved value, as the store also accepts", () => {
    window.localStorage.setItem(CONTENT_SCALE_STORE.key, "137.5");
    expect(readStore(CONTENT_SCALE_STORE)).toBe(137.5);
    runScript();
    expect(applied()).toBe("1.375");
  });

  it("leaves the stylesheet default when nothing, the default or something invalid is saved", () => {
    runScript();
    expect(applied()).toBe("");
    for (const value of ["default", 175, "150", null]) {
      save(value);
      runScript();
      expect(applied()).toBe("");
    }
    save(150, 2);
    runScript();
    expect(applied()).toBe("");
    window.localStorage.setItem(CONTENT_SCALE_STORE.key, "{not json");
    expect(runScript).not.toThrow();
    expect(applied()).toBe("");
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(runScript).not.toThrow();
    expect(applied()).toBe("");
  });
});

describe("content size after load", () => {
  it("keeps the size the script applied through hydration", async () => {
    setContentScale(150);
    runScript();
    const host = document.createElement("div");
    host.innerHTML = renderToString(<ContentScaleSync />);
    document.body.appendChild(host);
    const remove = vi.spyOn(root.style, "removeProperty");
    await act(async () => {
      hydrateRoot(host, <ContentScaleSync />);
    });
    expect(remove).not.toHaveBeenCalled();
    expect(applied()).toBe("1.5");
  });

  it("applies a choice from Settings straight away and saves it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() =>
      createRoot(host).render(
        <>
          <ContentScaleSync />
          <ContentScaleSetting />
        </>
      )
    );
    const option = (label: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>("[role=radio]")).find((button) => button.textContent === label)!;

    expect(option("Default (125%)").getAttribute("aria-checked")).toBe("true");
    act(() => option("150%").click());
    expect(applied()).toBe("1.5");
    expect(readStore(CONTENT_SCALE_STORE)).toBe(150);
    expect(option("150%").getAttribute("aria-checked")).toBe("true");

    act(() => option("Default (125%)").click());
    expect(applied()).toBe("");
    expect(readStore(CONTENT_SCALE_STORE)).toBe("default");
  });

  it("still applies a choice it could not save, and says so", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => createRoot(host).render(<ContentScaleSetting />));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const option = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=radio]")).find((button) => button.textContent === "150%")!;
    act(() => option.click());
    expect(applied()).toBe("1.5");
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(/Could not save/);
  });

  it("follows a change made in another tab", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => createRoot(host).render(<ContentScaleSync />));
    save(100);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: CONTENT_SCALE_STORE.key }));
    });
    expect(applied()).toBe("1");
  });
});
