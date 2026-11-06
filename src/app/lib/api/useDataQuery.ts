"use client";

import { useCallback, useEffect, useEffectEvent, useSyncExternalStore } from "react";
import {
  ensureQuery,
  getQuerySnapshot,
  queryKey,
  subscribeQuery,
  type QueryDefinition,
  type QuerySnapshot,
} from "./queryClient";

export function useDataQuery<Variables, Data>(
  definition: QueryDefinition<Variables, Data>,
  variables: Variables,
  options: { enabled?: boolean } = {}
): QuerySnapshot<Data> & { refresh: () => Promise<Data> } {
  const key = queryKey(definition, variables);
  const enabled = options.enabled ?? true;

  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (enabled ? subscribeQuery(key, listener) : () => undefined),
      [enabled, key]
    ),
    () => getQuerySnapshot<Data>(key),
    () => getQuerySnapshot<Data>(key)
  );

  const load = useEffectEvent(() => {
    void ensureQuery(definition, variables).catch(() => undefined);
  });

  useEffect(() => {
    if (enabled) load();
  }, [enabled, key]);

  const refresh = () => ensureQuery(definition, variables, { force: true });

  return { ...snapshot, refresh };
}
