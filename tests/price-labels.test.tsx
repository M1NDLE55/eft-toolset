import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlotPicker, type PickerTarget } from "@/app/components/gun-builder/slot-picker";
import type { BuildItemData, PickItemData, PriceSources } from "@/app/lib/types/gunBuilder";

vi.mock("next/image", () => ({ default: () => null }));

const suppressor: PickItemData = {
  id: "hexagon",
  name: "AK-74 Hexagon 5.45x39 sound suppressor",
  shortName: "Hexagon",
  gridImageLink: null,
  weight: 0.46,
  traderPriceRUB: 113_392,
  fleaPriceRUB: 36_379,
  traderName: "Skier",
  traderLevel: 1,
  traderTask: "Chemical - Part 2",
  ergonomics: -5,
  recoilModifier: -0.01,
  conflictingItemIds: [],
  conflictingSlotIds: [],
};

vi.mock("@/app/lib/cache/gunBuilderHooks", () => ({
  useGunItems: () => ({
    items: new Map([[suppressor.id, suppressor]]),
    loading: false,
    refreshing: false,
    unavailable: new Set(),
    error: null,
    retry: () => {},
    gameMode: "regular",
  }),
}));

const rifle: BuildItemData = {
  id: "ak74",
  name: "AK-74",
  shortName: "AK-74",
  gridImageLink: null,
  weight: 3,
  traderPriceRUB: null,
  fleaPriceRUB: null,
  ergonomics: 40,
  recoilModifier: 0,
  recoilVertical: 100,
  recoilHorizontal: 200,
  isWeapon: true,
  conflictingItemIds: [],
  conflictingSlotIds: [],
  slots: [{ id: "muzzle", name: "Muzzle", nameId: "mod_muzzle", required: false, allowedItemIds: [suppressor.id] }],
};

const target: PickerTarget = {
  parentPath: [],
  slotId: "muzzle",
  slot: rifle.slots[0],
  currentItemId: null,
  parentItemId: rifle.id,
  container: null,
};

describe("slot picker prices", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function open(priceSources: PriceSources) {
    act(() =>
      root.render(
        <SlotPicker
          target={target}
          root={{ itemId: rifle.id, slots: {} }}
          lookup={new Map([[rifle.id, rifle]])}
          priceSources={priceSources}
          onClose={() => {}}
          onSelect={async () => {}}
          onRemove={() => {}}
        />
      )
    );
    const row = document.body.querySelector<HTMLButtonElement>("button[data-candidate]");
    expect(row).not.toBeNull();
    return row!;
  }

  const visible = (row: HTMLElement) => row.textContent!.replace(/\s/g, " ");

  it("labels a flea price as the flea market's, with the trader's offer at its own price and lock", () => {
    const row = open({ traders: true, flea: true });
    expect(visible(row)).toMatch(/36 379 ₽\s*Flea/);
    expect(visible(row)).not.toContain("Skier LL1");
    expect(row.querySelector('[aria-label^="After the task"]')).toBeNull();
    const label = [...row.querySelectorAll<HTMLElement>("[title]")].map((element) => element.title.replace(/\s/g, " "));
    expect(label).toContain("Skier LL1 sells it for 113 392 ₽ after the task Chemical - Part 2");
  });

  it("labels a trader price with that trader and the task that unlocks it", () => {
    const row = open({ traders: true, flea: false });
    expect(visible(row)).toMatch(/113 392 ₽\s*Skier LL1/);
    expect(visible(row)).not.toContain("Flea");
    expect(row.querySelector('[aria-label="After the task Chemical - Part 2"]')).not.toBeNull();
  });
});
