"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
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
  const key = useMemo(() => queryKey(definition, variables), [definition, variables]);
  const enabled = options.enabled ?? true;

  const snapshot = useSyncExternalStore(
    useCallback(
      (listener) => (enabled ? subscribeQuery(key, listener) : () => undefined),
      [enabled, key]
    ),
    useCallback(() => getQuerySnapshot<Data>(key), [key]),
    useCallback(() => getQuerySnapshot<Data>(key), [key])
  );

  useEffect(() => {
    if (!enabled) return;
    void ensureQuery(definition, variables).catch(() => undefined);
  }, [definition, enabled, key, variables]);

  const refresh = useCallback(
    () => ensureQuery(definition, variables, { force: true }),
    [definition, variables]
  );

  return { ...snapshot, refresh };
}
