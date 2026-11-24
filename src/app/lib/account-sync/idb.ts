/**
 * The account cache (§12.5): one IndexedDB database per account, `eft-toolset-account-<cacheKey>`,
 * written with plain IndexedDB because writes span several stores in one transaction.
 *
 * - records: `<kind>:<id>` → the server's record, the optimistic local value and any sync problem;
 * - queue: mutations not yet acknowledged, in order (auto-increment key);
 * - meta: the change-log cursor, the device id;
 * - plans, plan_queue, plan_issues: cached raid plans, their queued op batches and their
 *   "Couldn't apply" lists (§12.8).
 */
export const ACCOUNT_DB_VERSION = 1;
export const STORES = ["records", "queue", "meta", "plans", "plan_queue", "plan_issues"] as const;
export type StoreName = (typeof STORES)[number];

export function accountDbName(cacheKey: string) {
  return `eft-toolset-account-${cacheKey}`;
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openAccountDb(cacheKey: string): Promise<IDBDatabase> {
  const request = indexedDB.open(accountDbName(cacheKey), ACCOUNT_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "key" });
    if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    if (!db.objectStoreNames.contains("plans")) db.createObjectStore("plans", { keyPath: "planId" });
    if (!db.objectStoreNames.contains("plan_queue")) db.createObjectStore("plan_queue", { keyPath: ["planId", "seq"] });
    if (!db.objectStoreNames.contains("plan_issues")) db.createObjectStore("plan_issues", { keyPath: ["planId", "opId"] });
  };
  return promised(request);
}

export function deleteAccountDb(cacheKey: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(accountDbName(cacheKey));
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Runs work against the named stores in one transaction; resolves when it commits. */
export function transact<T>(db: IDBDatabase, stores: readonly StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores as StoreName[], mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The browser's storage refused the change."));
    try {
      result = work(tx);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

export async function readAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export async function readMeta<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("meta", "readonly").objectStore("meta").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
