import { getGroupItems, getMapDetails } from "@/app/lib/api/tarkov-server";
import type { GameMode } from "@/components/game-mode/mode";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { bestSell } from "@/app/lib/item-price";
import { isItemSlug } from "@/app/lib/item-links";
import { buildMapGuide } from "@/app/lib/seo/map";

export interface MapKeyRow {
  name: string;
  slug: string | null;
  gridImageLink: string | null;
  /** Locks on this map the key opens. */
  locks: number;
  /** Cheapest way to buy it: a trader, or the flea market's 24-hour average. */
  buyPrice: number | null;
  buySource: string | null;
  /** Best sell price, after the flea fee. */
  sellPrice: number | null;
  /** Tasks that use the key. */
  tasks: string[];
}

export interface MapKeys {
  key: string;
  name: string;
  keys: MapKeyRow[];
}

/** Every key that opens a lock on the map, with prices and the tasks that need it. */
export async function getMapKeys(gameMode: GameMode, mapKey: string): Promise<MapKeys | null> {
  const config = mapConfigs.find((map) => map.key === mapKey);
  if (!config) return null;
  const details = await getMapDetails(gameMode, mapKey);
  if (!details) return null;
  const guide = buildMapGuide(details);
  const items = await getGroupItems(gameMode, guide.keys.map((key) => key.name));
  const byName = new Map(items.map((item) => [item.name, item]));
  const keys = guide.keys.map((key): MapKeyRow => {
    const item = byName.get(key.name);
    const buy = item?.buyFor.reduce<(typeof item.buyFor)[number] | null>(
      (cheapest, offer) => (!cheapest || offer.priceRUB < cheapest.priceRUB ? offer : cheapest),
      null
    );
    const sell = item ? bestSell(item) : null;
    return {
      name: key.name,
      slug: key.normalizedName && isItemSlug(key.normalizedName) ? key.normalizedName : null,
      gridImageLink: item?.gridImageLink ?? null,
      locks: key.locks,
      buyPrice: buy?.priceRUB ?? null,
      buySource: buy ? buy.vendor.name : null,
      sellPrice: sell?.price ?? null,
      tasks: Array.from(new Set(item?.usedInTasks.map((task) => task.name) ?? [])),
    };
  });
  keys.sort((a, b) => (b.buyPrice ?? b.sellPrice ?? 0) - (a.buyPrice ?? a.sellPrice ?? 0) || a.name.localeCompare(b.name));
  return { key: config.key, name: config.name, keys };
}

/** How many keys each map has, for the keys hub. */
export async function getKeyCounts(gameMode: GameMode) {
  const counts = await Promise.all(
    mapConfigs.map(async (config) => {
      const details = await getMapDetails(gameMode, config.key);
      return { key: config.key, name: config.name, keys: details ? buildMapGuide(details).keys.length : 0 };
    })
  );
  return counts.filter((entry) => entry.keys > 0);
}
