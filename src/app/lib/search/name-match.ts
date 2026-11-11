import { normalizeText } from "./normalize-text";

// Names are compared the way players type them: case, accents, apostrophes, hyphens,
// spacing, and plural "s" are ignored, and small typos are tolerated.

export function nameWords(value: string) {
  return normalizeText(value)
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

/** Edit distance with adjacent transpositions, giving up above `limit`. */
export function editDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previousRow: number[] = [];
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previousRow[j - 2] + 1);
      next.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previousRow = row;
    row = next;
  }
  return row[b.length];
}

/** How many typos a name of this length can have and still match on its own. */
export function typoAllowance(length: number) {
  return length <= 3 ? 0 : length <= 8 ? 1 : 2;
}
