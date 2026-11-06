import { describe, expect, it } from "vitest";
import { appendPoint, changeSinceLastVisit } from "@/app/lib/price-history";

const HOUR = 60 * 60_000;

describe("local price history", () => {
  it("records at most one point per hour, keeping the latest price in that hour", () => {
    const first = appendPoint([], 100, 0);
    expect(appendPoint(first, 100, HOUR / 2)).toBe(first);
    expect(appendPoint(first, 120, HOUR / 2)).toEqual([{ t: 0, p: 120 }]);
    expect(appendPoint(first, 130, HOUR)).toEqual([{ t: 0, p: 100 }, { t: HOUR, p: 130 }]);
  });

  it("compares against the most recent point from an earlier visit", () => {
    const points = [{ t: 0, p: 100 }, { t: 5 * HOUR, p: 200 }, { t: 5.5 * HOUR, p: 400 }];
    expect(changeSinceLastVisit(points, 300, 6 * HOUR)).toEqual({ since: 5 * HOUR, previous: 200, ratio: 0.5 });
    expect(changeSinceLastVisit([{ t: 0, p: 100 }], 100, HOUR / 2)).toBeNull();
  });
});
