"use client";

export interface StoreDefinition<T> {
  key: string;
  legacyKeys?: string[];
  version: number;
  defaultValue: () => T;
  validate: (value: unknown) => value is T;
  migrate?: (value: unknown, version: number) => T | undefined;
}

interface StoreEnvelope<T> {
  version: number;
  data: T;
}

export function readStore<T>(definition: StoreDefinition<T>): T {
  if (typeof window === "undefined") return definition.defaultValue();
  let sourceKey = definition.key;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(definition.key);
    if (!raw) {
      for (const legacyKey of definition.legacyKeys ?? []) {
        const legacy = window.localStorage.getItem(legacyKey);
        if (!legacy) continue;
        sourceKey = legacyKey;
        raw = legacy;
        break;
      }
    }
  } catch {
    return definition.defaultValue();
  }
  if (!raw) return definition.defaultValue();

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Older scalar settings were stored as unquoted strings.
      parsed = raw;
    }
    if (definition.validate(parsed)) {
      try {
        writeStore(definition, parsed);
        if (sourceKey !== definition.key) window.localStorage.removeItem(sourceKey);
      } catch {
        // The legacy value is still valid and readable if migration cannot be persisted.
      }
      return parsed;
    }
    if (isEnvelope(parsed)) {
      if (parsed.version === definition.version && definition.validate(parsed.data)) {
        if (sourceKey !== definition.key) {
          try {
            writeStore(definition, parsed.data);
            window.localStorage.removeItem(sourceKey);
          } catch {
            // Keep the valid legacy envelope in place.
          }
        }
        return parsed.data;
      }
      const migrated = definition.migrate?.(parsed.data, parsed.version);
      if (migrated && definition.validate(migrated)) {
        try {
          writeStore(definition, migrated);
          if (sourceKey !== definition.key) window.localStorage.removeItem(sourceKey);
        } catch {
          // The in-memory migration is still safe to return.
        }
        return migrated;
      }
    }
    quarantine(sourceKey, raw);
  } catch {
    quarantine(sourceKey, raw);
  }
  return definition.defaultValue();
}

export function writeStore<T>(definition: StoreDefinition<T>, value: T): T {
  if (!definition.validate(value)) throw new Error(`Refusing to persist invalid ${definition.key} data.`);
  if (typeof window === "undefined") return value;

  const envelope: StoreEnvelope<T> = { version: definition.version, data: value };
  try {
    window.localStorage.setItem(definition.key, JSON.stringify(envelope));
  } catch (error) {
    throw new Error(
      `Could not save ${definition.key}. Browser storage may be full or unavailable.`,
      { cause: error }
    );
  }
  try {
    window.dispatchEvent(new CustomEvent("eft-toolset:storage", { detail: definition.key }));
  } catch {
    // Notification failure does not mean persistence failed.
  }
  return value;
}

export function subscribeStore(key: string, listener: () => void) {
  const local = (event: Event) => {
    if ((event as CustomEvent<string>).detail === key) listener();
  };
  const remote = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener("eft-toolset:storage", local);
  window.addEventListener("storage", remote);
  return () => {
    window.removeEventListener("eft-toolset:storage", local);
    window.removeEventListener("storage", remote);
  };
}

function isEnvelope(value: unknown): value is StoreEnvelope<unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Partial<StoreEnvelope<unknown>>).version === "number" &&
    "data" in (value as object)
  );
}

function quarantine(key: string, raw: string) {
  try {
    window.localStorage.setItem(`${key}:corrupt:${Date.now()}`, raw);
    window.localStorage.removeItem(key);
  } catch {
    // Preserve the original key when quarantine cannot be written.
  }
}
