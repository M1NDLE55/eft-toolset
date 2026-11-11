import { useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from "react";
import { useGameMode, type GameMode } from "@/components/game-mode/context";
import { useDataQuery } from "@/app/lib/api/useDataQuery";
import type { AmmoItemData, GunItem, GunListItem } from "@/app/lib/types/gunBuilder";
import type { ItemLookup } from "@/app/lib/builds/stats";
import { presetParts, type PurchaseContext } from "@/app/lib/builds/purchase";
import {
  ensureAmmoItems,
  ensureGunItems,
  getAmmoState,
  getGunItemState,
  gunListQuery,
  presetQuery,
  subscribeGunItems,
  unresolvedGunItems,
  type GunItemState,
} from "./gunBuilder";

const EMPTY_GUNS: GunListItem[] = [];

function otherMode(gameMode: GameMode): GameMode {
  return gameMode === "pve" ? "regular" : "pve";
}

export function useGunList() {
  const { gameMode, hydrated } = useGameMode();
  const variables = useMemo(() => ({ gameMode }), [gameMode]);
  const query = useDataQuery(gunListQuery, variables, { enabled: hydrated });
  const [previous, setPrevious] = useState<GunListItem[] | null>(null);
  if (query.data && query.data !== previous) setPrevious(query.data);
  const guns = query.data ?? previous ?? EMPTY_GUNS;
  const byId = useMemo(() => new Map(guns.map((gun) => [gun.id, gun])), [guns]);

  return {
    guns,
    byId,
    loading: guns.length === 0 && query.status !== "error",
    error: guns.length === 0 ? (query.error ?? null) : null,
    retry: () => void query.refresh().catch(() => undefined),
  };
}

function useModeState(gameMode: GameMode): GunItemState {
  return useSyncExternalStore(
    subscribeGunItems,
    () => getGunItemState(gameMode),
    () => getGunItemState(gameMode)
  );
}

export function useGunItems(
  ids: readonly string[],
  detail: "full" | "basic",
  enabled = true
): {
  items: ItemLookup;
  loading: boolean;
  refreshing: boolean;
  unavailable: ReadonlySet<string>;
  error: Error | null;
  retry: () => void;
  gameMode: GameMode;
} {
  const { gameMode, hydrated } = useGameMode();
  const current = useModeState(gameMode);
  const fallback = useModeState(otherMode(gameMode));
  const key = useMemo(() => Array.from(new Set(ids)).sort().join(","), [ids]);
  const active = hydrated && enabled && key.length > 0;

  const load = useEffectEvent(() => {
    void ensureGunItems(ids, gameMode, detail).catch(() => undefined);
  });

  useEffect(() => {
    if (active) load();
  }, [active, key, gameMode, detail]);

  const items = useMemo(() => {
    const complete = ids.every((id) => current.items.has(id));
    if (complete || fallback.items.size === 0) return current.items;
    const merged = new Map<string, GunItem>();
    for (const id of ids) {
      const item = current.items.get(id) ?? fallback.items.get(id);
      if (item) merged.set(id, item);
    }
    for (const [id, item] of current.items) merged.set(id, item);
    return merged;
  }, [current.items, fallback.items, ids]);

  const unresolved = unresolvedGunItems(ids, current, detail);
  const pending = ids.some((id) => current.pending.has(id));
  const waiting = unresolved.length > 0 && (pending || !current.error);

  return {
    items,
    loading: !hydrated || (enabled && waiting && unresolved.some((id) => !items.has(id))),
    refreshing: enabled && (pending || waiting),
    unavailable: current.missing,
    error: unresolved.length > 0 ? current.error : null,
    retry: () => void ensureGunItems(ids, gameMode, detail).catch(() => undefined),
    gameMode,
  };
}

export function useAmmoItems(ids: readonly string[], enabled = true): {
  items: ReadonlyMap<string, AmmoItemData>;
  loading: boolean;
  error: Error | null;
  retry: () => void;
} {
  const { gameMode, hydrated } = useGameMode();
  const state = useSyncExternalStore(
    subscribeGunItems,
    () => getAmmoState(gameMode),
    () => getAmmoState(gameMode)
  );
  const key = useMemo(() => Array.from(new Set(ids)).sort().join(","), [ids]);
  const active = hydrated && enabled && key.length > 0;

  const load = useEffectEvent(() => {
    void ensureAmmoItems(ids, gameMode).catch(() => undefined);
  });

  useEffect(() => {
    if (active) load();
  }, [active, key, gameMode]);

  const unresolved = ids.filter((id) => !state.items.has(id) && !state.missing.has(id));
  return {
    items: state.items,
    loading: !hydrated || (active && unresolved.length > 0 && !state.error),
    error: unresolved.length > 0 ? state.error : null,
    retry: () => void ensureAmmoItems(ids, gameMode).catch(() => undefined),
  };
}

/** How a build of this weapon is priced: with the parts its default preset comes with, once they load. */
export function usePurchaseContext(weaponId: string, presetId: string | null | undefined): PurchaseContext {
  const { gameMode, hydrated } = useGameMode();
  const variables = useMemo(() => ({ gameMode, id: presetId ?? "" }), [gameMode, presetId]);
  const query = useDataQuery(presetQuery, variables, { enabled: hydrated && Boolean(presetId) });
  return useMemo(
    () => ({ preset: presetId ? presetParts(weaponId, query.data) : null }),
    [presetId, weaponId, query.data]
  );
}
