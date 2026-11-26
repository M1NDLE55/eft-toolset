// What a priced page's server function takes for live prices: imported by route files, so it stays
// free of server code.

/** A price version: a positive whole number, as the refresher sends it and pages pass back as `p`. */
export function isPriceVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** A priced page's server-function input: the version a page refetching after a push needs, if any. */
export interface LivePricesInput {
  p?: number;
}

export function livePricesInput(input: LivePricesInput | undefined): LivePricesInput {
  const p = input?.p;
  return isPriceVersion(p) ? { p } : {};
}
