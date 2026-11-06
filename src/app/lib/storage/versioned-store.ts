export interface StoreDefinition<T> {
  key: string;
  legacyKeys?: string[];
  version: number;
  defaultValue: () => T;
  validate: (value: unknown) => value is T;
  migrate?: (value: unknown, version: number) => T | undefined;
  recover?: (value: unknown) => T | undefined;
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
      parsed = raw;
    }
    if (definition.validate(parsed)) {
      try {
        writeStore(definition, parsed);
        if (sourceKey !== definition.key) window.localStorage.removeItem(sourceKey);
      } catch {
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
          }
        }
        return parsed.data;
      }
      const migrated = definition.migrate?.(parsed.data, parsed.version);
      if (migrated !== undefined && definition.validate(migrated)) {
        try {
          writeStore(definition, migrated);
          if (sourceKey !== definition.key) window.localStorage.removeItem(sourceKey);
        } catch {
        }
        return migrated;
      }
    }
    const recovered = definition.recover?.(isEnvelope(parsed) ? parsed.data : parsed);
    if (recovered !== undefined && definition.validate(recovered)) {
      try {
        writeStore(definition, recovered);
        if (sourceKey !== definition.key) window.localStorage.removeItem(sourceKey);
      } catch {
      }
      return recovered;
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
  }
  return value;
}

export function writeStores(entries: readonly { definition: StoreDefinition<unknown>; value: unknown }[]) {
  const serialized = entries.map(({ definition, value }) => {
    if (!definition.validate(value)) throw new Error(`Refusing to persist invalid ${definition.key} data.`);
    let text: string;
    try {
      text = JSON.stringify({ version: definition.version, data: value });
    } catch {
      throw new Error(`Could not prepare ${definition.key} for saving.`);
    }
    return { key: definition.key, text };
  });
  const previous = serialized.map(({ key }) => ({ key, text: window.localStorage.getItem(key) }));
  try {
    for (const { key, text } of serialized) window.localStorage.setItem(key, text);
  } catch (error) {
    for (const { key, text } of previous) {
      try {
        if (text === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, text);
      } catch {
        continue;
      }
    }
    throw new Error("Could not save. Browser storage may be full or unavailable; nothing was changed.", { cause: error });
  }
  for (const { key } of serialized) {
    window.dispatchEvent(new CustomEvent("eft-toolset:storage", { detail: key }));
  }
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
    const prefix = `${key}:corrupt:`;
    window.localStorage.setItem(`${prefix}${Date.now()}`, raw);
    window.localStorage.removeItem(key);
    const backups: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const candidate = window.localStorage.key(index);
      if (candidate?.startsWith(prefix)) backups.push(candidate);
    }
    backups.sort();
    for (const obsolete of backups.slice(0, Math.max(0, backups.length - 3))) {
      window.localStorage.removeItem(obsolete);
    }
  } catch {
  }
}
