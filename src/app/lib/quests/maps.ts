import { getMapConfig } from "@/app/lib/raid-planner/maps-config";

// Variants of a map that share its layout, and so its raid planner and keys pages.
const VARIANT_OF: Record<string, string> = {
  "night-factory": "factory",
  "infected-factory": "factory",
  "ground-zero-21": "ground-zero",
  "ground-zero-tutorial": "ground-zero",
  "the-lab-dark": "the-lab",
  "infected-lab": "the-lab",
};

/** The raid planner and /keys page key for a tarkov.dev map key, or null when there is no page. */
export function mapPageKey(key: string): string | null {
  const page = Object.hasOwn(VARIANT_OF, key) ? VARIANT_OF[key] : key;
  return getMapConfig(page) ? page : null;
}
