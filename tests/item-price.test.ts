import { describe, expect, it } from "vitest";
import { bestSell } from "@/app/lib/item-price";

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
