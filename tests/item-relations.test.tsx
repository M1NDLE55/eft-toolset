import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HideoutUses, UsedInTasks } from "@/app/components/item/item-relations";
import GenericDetails from "@/app/components/item/generic-details";
import type { ComposedItem } from "@/app/lib/cache/types";

vi.mock("next/image", () => ({ default: () => null }));

const rifle: ComposedItem = {
  id: "rifle",
  normalizedName: "rifle",
  name: "Rifle",
  shortName: "R",
  gridImageLink: null,
  wikiLink: null,
  fleaMarketFee: 1_000,
  width: 1,
  height: 1,
  changeLast48hPercent: null,
  buyFor: [],
  sellFor: [{ vendor: { name: "Prapor" }, priceRUB: 8_000 }],
  weapon: { defaultWidth: 5, defaultHeight: 2 },
  usedInTasks: [],
  hideoutRequirements: [],
  hideoutSlots: [],
  bartersUsing: [],
  craftsUsing: [],
};

describe("item page relations", () => {
  let host: HTMLDivElement;
  let root: Root;

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

  it("lists hideout upgrades and slots that use the item", () => {
    act(() =>
      root.render(
        <HideoutUses
          requirements={[{ station: { name: "Medstation" }, level: 3, count: 1, foundInRaid: true }]}
          slots={[{ station: { name: "Bitcoin Farm" }, level: 1, slots: 10 }]}
        />
      )
    );
    expect(host.textContent).toContain("Medstation III");
    expect(host.textContent).toContain("1× for the upgrade, found in raid");
    expect(host.textContent).toContain("Adds 10 slots to install it in");
  });

  it("shows each task objective's count and found-in-raid flag", () => {
    act(() =>
      root.render(
        <UsedInTasks
          tasks={[
            {
              name: "Crisis",
              minPlayerLevel: 10,
              wikiLink: null,
              trader: { name: "Therapist" },
              faction: "BEAR",
              objectives: [{ description: "Hand over the items", type: "giveItem", count: 2, foundInRaid: true, alternatives: 0 }],
            },
          ]}
        />
      )
    );
    expect(host.textContent).toContain("BEAR");
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Hand over the items2×, found in raid");
  });

  it("gives weapons no per-slot value and shows their default build size", () => {
    act(() => root.render(<GenericDetails item={rifle} />));
    expect(host.textContent).toContain("1×1 stripped");
    expect(host.textContent).toContain("5×2 default build");
    expect(host.textContent).toContain("Depends on attachments");
  });
});
