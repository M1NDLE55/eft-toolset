import { describe, expect, it } from "vitest";
import { bestSell, fleaPrices } from "@/app/lib/item-price";

const offer = (name: string, priceRUB: number) => ({ vendor: { name }, priceRUB });

describe("best sell price", () => {
  it("compares flea net of fees against traders", () => {
    expect(
      bestSell({ sellFor: [offer("Flea Market", 30_000), offer("Therapist", 26_000)], fleaMarketFee: 5_000 })
    ).toEqual({ vendor: "Therapist", price: 26_000, flea: false });
    expect(
      bestSell({ sellFor: [offer("Flea Market", 30_000), offer("Therapist", 20_000)], fleaMarketFee: 5_000 })
    ).toEqual({ vendor: "Flea Market", price: 25_000, flea: true });
  });

  it("ignores flea offers that cannot be listed and unprofitable listings", () => {
    expect(bestSell({ sellFor: [offer("Flea Market", 30_000)], fleaMarketFee: null })).toBeNull();
    expect(bestSell({ sellFor: [offer("Flea Market", 1_000)], fleaMarketFee: 2_000 })).toBeNull();
  });
});

describe("flea prices", () => {
  it("separates the lowest listing from the 24-hour average", () => {
    expect(
      fleaPrices({ buyFor: [offer("Flea Market", 102_539)], sellFor: [offer("Flea Market", 60_000)] })
    ).toEqual({ lowestListing: 60_000, avg24h: 102_539 });
  });

  it("has no separate average when the buy price fell back to the lowest listing", () => {
    expect(
      fleaPrices({ buyFor: [offer("Flea Market", 60_000)], sellFor: [offer("Flea Market", 60_000)] })
    ).toEqual({ lowestListing: 60_000, avg24h: null });
  });

  it("is null for items that cannot be traded on the flea", () => {
    expect(fleaPrices({ buyFor: [offer("Prapor", 1_000)], sellFor: [offer("Prapor", 500)] })).toBeNull();
  });
});
