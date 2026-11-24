/**
 * Fractional order keys for the route (§11.5): each waypoint's key sorts between its neighbours, so
 * two people inserting at once both keep their points. Keys are base-62 fractions ("0.<key>"),
 * compared as plain strings (the digits are in ASCII order), never ending in "0" so there is always
 * room between two of them. Equal keys are ordered by id.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
export const ORDER_KEY_PATTERN = /^[0-9A-Za-z]{1,64}$/;

export function isOrderKey(value: unknown): value is string {
  return typeof value === "string" && ORDER_KEY_PATTERN.test(value) && !value.endsWith(ZERO);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`Order keys out of order: ${a} >= ${b}`);
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a ? DIGITS.indexOf(a[0]) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low] + midpoint(a.slice(1), null);
}

/** A key strictly between `before` and `after` (null: the start or end of the route). */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    // Equal keys (two concurrent inserts) sort by id; nudge past the first.
    return midpoint(before, null);
  }
  return midpoint(before ?? "", after);
}

/** n evenly spread, short keys in order, for a new plan's route. */
export function spreadKeys(n: number): string[] {
  if (n <= 0) return [];
  let width = 1;
  while (DIGITS.length ** width <= n * 2) width += 1;
  const span = DIGITS.length ** width;
  const keys: string[] = [];
  for (let index = 1; index <= n; index += 1) {
    let value = Math.floor((index * span) / (n + 1));
    let key = "";
    for (let digit = 0; digit < width; digit += 1) {
      key = DIGITS[value % DIGITS.length] + key;
      value = Math.floor(value / DIGITS.length);
    }
    keys.push(key.replace(/0+$/, "") || "V");
  }
  return keys;
}

export function compareOrder(a: { ord: string; id: string }, b: { ord: string; id: string }) {
  return a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
