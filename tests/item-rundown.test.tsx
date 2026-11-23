import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposedItem } from "@/app/lib/cache/types";
import { taskUses } from "@/app/lib/item-needs";
import { bestBuy } from "@/app/lib/item-price";
import { placeCard } from "@/app/components/item/rundown/placement";

const navigations: string[] = [];
const apiFetch = vi.fn();

vi.mock("@/app/lib/navigation/image", () => ({ default: () => null }));
let pathname = "/quests/background-check";
vi.mock("@/app/lib/navigation/hooks", () => ({ usePathname: () => pathname }));
// A stand-in for the app's Link: it runs the link's click handler and, unless that prevents it, "navigates".
vi.mock("@/app/lib/navigation/link", () => ({
  default: ({ href, onClick, prefetch: _prefetch, children, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a
      {...props}
      href={String(href)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) navigations.push(String(href));
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
// No IndexedDB in jsdom: the query cache keeps entries in memory only.
vi.mock("@/app/lib/cache/store", () => {
  const none = () => Promise.resolve(undefined);
  return { cacheGet: none, cacheSet: none, cacheGetMany: () => Promise.resolve([]), cacheSetMany: none, cacheDelete: none, cacheDeleteMany: none, cacheKeys: () => Promise.resolve([]), cacheClear: none };
});
vi.mock("@/app/lib/api/transport", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const { GameModeProvider } = await import("@/components/game-mode/context");
const { ItemRundownLink, ItemRundownProvider, ItemRundownQuest, isPlainClick } = await import(
  "@/app/components/item/rundown/rundown-link"
);

function item(overrides: Partial<ComposedItem> = {}): ComposedItem {
  return {
    id: "5937ee6486f77408994ba448",
    normalizedName: "machinery-key",
    name: "Machinery key",
    shortName: "Machinery",
    gridImageLink: null,
    wikiLink: null,
    fleaMarketFee: 2_000,
    width: 1,
    height: 1,
    changeLast48hPercent: null,
    buyFor: [
      { vendor: { name: "Flea Market" }, priceRUB: 30_000 },
      { vendor: { name: "Mechanic" }, priceRUB: 25_000, minTraderLevel: 2 },
    ],
    sellFor: [
      { vendor: { name: "Flea Market" }, priceRUB: 28_000 },
      { vendor: { name: "Therapist" }, priceRUB: 9_000 },
    ],
    usedInTasks: [
      {
        name: "Background Check",
        minPlayerLevel: 5,
        wikiLink: null,
        trader: { name: "Prapor" },
        objectives: [{ description: "Hand over the key", type: "giveItem", count: 1, foundInRaid: true }],
      },
      {
        name: "Other Quest",
        minPlayerLevel: 10,
        wikiLink: null,
        trader: { name: "Skier" },
        objectives: [{ description: "Use the key", type: "useItem" }],
      },
    ],
    hideoutRequirements: [{ station: { name: "Workbench" }, level: 2, count: 3, foundInRaid: false }],
    hideoutSlots: [],
    bartersUsing: [],
    craftsUsing: [],
    key: {
      maps: [{ key: "customs", name: "Customs", locks: 1 }],
      opens: "Unlocks the driver-side door of the orange tanker truck.",
    },
    ...overrides,
  };
}

describe("item rundown helpers", () => {
  it("places the card below its link, flips above near the bottom and stays on screen", () => {
    const viewport = { width: 1000, height: 800 };
    const card = { width: 352, height: 300 };
    expect(placeCard({ top: 100, left: 50, width: 80, height: 20 }, card, viewport)).toMatchObject({ top: 126, left: 50, side: "below" });
    const above = placeCard({ top: 700, left: 50, width: 80, height: 20 }, card, viewport);
    expect(above).toMatchObject({ side: "above", top: 700 - 6 - 300 });
    expect(placeCard({ top: 100, left: 900, width: 80, height: 20 }, card, viewport).left).toBe(1000 - 8 - 352);
    expect(placeCard({ top: 100, left: -20, width: 80, height: 20 }, card, viewport).left).toBe(8);
    // Too tall for either side: it takes the roomier side, capped to fit.
    const tall = placeCard({ top: 300, left: 50, width: 80, height: 20 }, { width: 352, height: 2_000 }, viewport);
    expect(tall.side).toBe("below");
    expect(tall.top + tall.maxHeight).toBeLessThanOrEqual(800 - 8);
  });

  it("treats only an unmodified left click as plain", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });

  it("picks the page's quest out of the item's tasks, and the cheapest buy offer", () => {
    const key = item();
    const { current, others } = taskUses(key, { name: "Background Check", trader: "Prapor", faction: null });
    expect(current?.need).toEqual({ count: 1, foundInRaid: 1 });
    expect(others.map((use) => use.task.name)).toEqual(["Other Quest"]);
    expect(taskUses(key, { name: "Background Check", trader: "Skier" }).current).toBeNull();
    expect(taskUses(key, { name: "Background Check", trader: null }).current).not.toBeNull();
    const usec = item({ usedInTasks: [{ ...key.usedInTasks[0], faction: "USEC" }] });
    expect(taskUses(usec, { name: "Background Check", trader: "Prapor", faction: "BEAR" }).current).toBeNull();
    expect(taskUses(usec, { name: "Background Check", trader: "Prapor", faction: "USEC" }).current).not.toBeNull();
    expect(taskUses(usec, { name: "Background Check", trader: "Prapor", faction: null }).current).not.toBeNull();
    expect(taskUses(key).current).toBeNull();
    expect(bestBuy(key)?.vendor.name).toBe("Mechanic");
  });
});

describe("item rundown popup", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    navigations.length = 0;
    pathname = "/quests/background-check";
    apiFetch.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  let slugs = 0;
  /** Each test uses its own slug, so the shared query cache can't answer for another test. */
  function mount({ quest = false }: { quest?: boolean } = {}) {
    slugs += 1;
    const slug = `machinery-key-${slugs}`;
    const link = <ItemRundownLink item={{ name: "Machinery key", normalizedName: slug }}>Machinery key</ItemRundownLink>;
    act(() =>
      root.render(
        <GameModeProvider>
          <ItemRundownProvider>
            <button type="button">Elsewhere</button>
            {quest ? <ItemRundownQuest quest={{ name: "Background Check", trader: "Prapor", faction: null }}>{link}</ItemRundownQuest> : link}
          </ItemRundownProvider>
        </GameModeProvider>
      )
    );
    return { slug, anchor: host.querySelector<HTMLAnchorElement>(`a[href="/item/${slug}"]`)! };
  }

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const click = (target: Element, init: MouseEventInit = {}) =>
    act(() => void target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })));
  const key = (target: Element, name: string, init: KeyboardEventInit = {}) =>
    act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })));
  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

  it("keeps a real link to the item page, as rendered without JavaScript", () => {
    const html = renderToString(
      <GameModeProvider>
        <ItemRundownProvider>
          <ItemRundownLink item={{ name: "Machinery key", normalizedName: "machinery-key" }}>Machinery key</ItemRundownLink>
        </ItemRundownProvider>
      </GameModeProvider>
    );
    expect(html).toContain('href="/item/machinery-key"');
    expect(html).not.toContain("dialog");
  });

  it("follows the link without a provider", () => {
    act(() => root.render(<ItemRundownLink item={{ name: "Machinery key", normalizedName: "machinery-key" }}>Machinery key</ItemRundownLink>));
    click(host.querySelector("a")!);
    expect(navigations).toEqual(["/item/machinery-key"]);
    expect(dialog()).toBeNull();
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["middle", { button: 1 }],
  ])("lets a %s click follow the link", async (_label, init) => {
    const { anchor, slug } = mount();
    click(anchor, init);
    await settle();
    expect(navigations).toEqual([`/item/${slug}`]);
    expect(dialog()).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("opens on a plain click without navigating, loading the item only then, with a skeleton meanwhile", async () => {
    let resolve!: (value: ComposedItem) => void;
    apiFetch.mockReturnValue(new Promise((done) => (resolve = done)));
    const { anchor, slug } = mount({ quest: true });
    await settle();
    expect(apiFetch).not.toHaveBeenCalled();

    click(anchor);
    expect(navigations).toEqual([]);
    const open = dialog()!;
    expect(open).not.toBeNull();
    expect(open.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(open.getAttribute("aria-labelledby")!)?.textContent).toBe("Machinery key");
    await settle();
    expect(apiFetch).toHaveBeenCalledWith("item.detail", { gameMode: "regular", slug }, expect.anything());
    expect(open.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(open.querySelector(`a[href="/item/${slug}"]`)?.textContent).toBe("Open full page");

    await act(async () => resolve(item({ normalizedName: slug })));
    expect(open.querySelector('[aria-busy="true"]')).toBeNull();
    const text = open.textContent!;
    // Best buy is the cheapest offer; best sell is the flea's after its fee, labelled as the item page does.
    expect(text).toContain("Best buy");
    expect(text).toMatch(/25\s000/);
    expect(text).toContain("Mechanic LL2");
    expect(text).toMatch(/26\s000/);
    expect(text).toContain("Flea, after fee");
    expect(text).toContain("This quest");
    expect(text).toContain("×1FIR");
    expect(text).toContain("Also needed for");
    // The total takes in this quest too, so it isn't shown beside the other uses.
    expect(text).not.toContain("in all");
    expect(text).toContain("Other Quest");
    expect(text).toContain("Workbench");
  });

  it("shows a key's lock and maps, linking to that map's keys", async () => {
    apiFetch.mockResolvedValue(item());
    const { anchor } = mount();
    click(anchor);
    await settle();
    const open = dialog()!;
    expect(open.textContent).toContain("Unlocks the driver-side door of the orange tanker truck.");
    const mapLink = open.querySelector<HTMLAnchorElement>('a[href="/keys/customs"]');
    expect(mapLink?.textContent).toContain("Customs keys");
    expect(mapLink?.textContent).toContain("1 lock");
    expect(open.textContent).toContain("Needed for");
  });

  it("lists a few uses and counts the rest", async () => {
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      name: `Quest ${index}`,
      minPlayerLevel: 1,
      wikiLink: null,
      trader: { name: "Prapor" },
      objectives: [{ description: null, type: "giveItem", count: 1 }],
    }));
    apiFetch.mockResolvedValue(item({ usedInTasks: tasks, key: undefined }));
    const { anchor } = mount();
    click(anchor);
    await settle();
    const text = dialog()!.textContent!;
    expect(text).toContain("Quest 2");
    expect(text).not.toContain("Quest 3");
    expect(text).toContain("+2 more");
    expect(text).not.toContain("Opens");
  });

  it("shows a short message and the full page link when loading fails", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    const { anchor, slug } = mount();
    click(anchor);
    await vi.waitFor(() => expect(dialog()?.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 5_000 });
    expect(dialog()!.textContent).toContain("Couldn't load this item's details");
    expect(dialog()!.querySelector(`a[href="/item/${slug}"]`)).not.toBeNull();
  }, 10_000);

  it("loads the item for the PVE game mode when that is selected", async () => {
    window.localStorage.setItem("eft-toolset:settings:game-mode", JSON.stringify({ version: 1, data: "pve" }));
    apiFetch.mockResolvedValue(item());
    const { anchor, slug } = mount();
    await settle();
    click(anchor);
    await settle();
    expect(apiFetch).toHaveBeenCalledWith("item.detail", { gameMode: "pve", slug }, expect.anything());
  });

  it("closes on Escape and returns focus to the link", async () => {
    apiFetch.mockResolvedValue(item());
    const { anchor } = mount();
    anchor.focus();
    click(anchor);
    await settle();
    // Placed against the link once its portal has mounted, and focused.
    expect(dialog()!.dataset.rundownLayout).toBe("card");
    expect(dialog()!.style.opacity).toBe("");
    expect(dialog()!.style.top).toMatch(/px$/);
    expect(document.activeElement).toBe(dialog());
    key(document.activeElement!, "Escape");
    expect(dialog()).toBeNull();
    await settle();
    expect(document.activeElement).toBe(anchor);
  });

  it("closes with the close button and on a click outside", async () => {
    apiFetch.mockResolvedValue(item());
    const { anchor } = mount();
    click(anchor);
    await settle();
    click(dialog()!.querySelector('button[aria-label="Close"]')!);
    expect(dialog()).toBeNull();
    await settle();
    expect(document.activeElement).toBe(anchor);

    click(anchor);
    await settle();
    expect(dialog()).not.toBeNull();
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })));
    expect(dialog()).toBeNull();
  });

  it("keeps focus inside while open", async () => {
    apiFetch.mockResolvedValue(item());
    const { anchor } = mount();
    click(anchor);
    await settle();
    const open = dialog()!;
    const close = open.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    close.focus();
    key(close, "Tab");
    expect(open.contains(document.activeElement)).toBe(true);
    key(open.querySelector("a")!, "Tab", { shiftKey: true });
    expect(open.contains(document.activeElement)).toBe(true);
    // The page behind is out of reach.
    expect(host.querySelector("button")!.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("says so when the item has no details in this game mode", async () => {
    apiFetch.mockResolvedValue(null);
    const { anchor, slug } = mount();
    click(anchor);
    await settle();
    expect(dialog()!.textContent).toContain("No details for this item in this game mode.");
    expect(dialog()!.querySelector(`a[href="/item/${slug}"]`)).not.toBeNull();
  });

  it("leaves links that open elsewhere, or point at the page it's on, as links", async () => {
    act(() =>
      root.render(
        <GameModeProvider>
          <ItemRundownProvider>
            <ItemRundownLink item={{ name: "Machinery key", normalizedName: "machinery-key" }} target="_blank">
              New tab
            </ItemRundownLink>
          </ItemRundownProvider>
        </GameModeProvider>
      )
    );
    click(host.querySelector("a")!);
    expect(dialog()).toBeNull();
    expect(navigations).toEqual(["/item/machinery-key"]);

    pathname = "/item/machinery-key";
    act(() =>
      root.render(
        <GameModeProvider>
          <ItemRundownProvider>
            <ItemRundownLink item={{ name: "Machinery key", normalizedName: "machinery-key" }}>Here</ItemRundownLink>
          </ItemRundownProvider>
        </GameModeProvider>
      )
    );
    click(host.querySelector("a")!);
    expect(dialog()).toBeNull();
    expect(navigations).toEqual(["/item/machinery-key", "/item/machinery-key"]);
  });

  it("closes when a link inside it is followed, even to the same page", async () => {
    apiFetch.mockResolvedValue(item());
    const { anchor } = mount();
    click(anchor);
    await settle();
    click(dialog()!.querySelector('a[href="/keys/customs"]')!);
    expect(navigations).toEqual(["/keys/customs"]);
    expect(dialog()).toBeNull();
  });

  it("shows a bottom sheet on phones and touch screens", async () => {
    const queries: string[] = [];
    const matchMedia = vi.fn((query: string) => {
      queries.push(query);
      return { matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList;
    });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      apiFetch.mockResolvedValue(item());
      const { anchor } = mount();
      click(anchor);
      await settle();
      expect(queries).toContain("(max-width: 639px), (pointer: coarse)");
      expect(dialog()!.dataset.rundownLayout).toBe("sheet");
      // Pinned to the bottom by its classes, not placed against the link.
      expect(dialog()!.style.top).toBe("");
      expect(dialog()!.className).toContain("bottom-0");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
