"use client";

import { useSyncExternalStore } from "react";
import { SIGNED_IN_COOKIE } from "@/app/lib/account/cookies";
import { AccountLibrary, type LibraryView } from "./account-library";
import { deleteAccountDb } from "./idb";

/**
 * Which library the app reads and writes (§12.1): the signed-out library in localStorage, or the
 * signed-in account's cache. The two never mix. A browser that looks signed in (the hint cookie)
 * and remembers its account's cache key opens the cache at once, so the account library works
 * offline; /api/account then confirms the account, and switches if it changed or ended.
 */
const CACHE_KEY_STORAGE = "eft-toolset:account-cache-key";

type Mode = "signed-out" | "account";

let library: AccountLibrary | null = null;
let mode: Mode = "signed-out";
let started = false;
const listeners = new Set<() => void>();
let unsubscribeLibrary: (() => void) | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function hintSignedIn() {
  return typeof document !== "undefined" && document.cookie.split(";").some((part) => part.trim() === `${SIGNED_IN_COOKIE}=1`);
}

function storedCacheKey() {
  try {
    return window.localStorage.getItem(CACHE_KEY_STORAGE);
  } catch {
    return null;
  }
}

function rememberCacheKey(cacheKey: string | null) {
  try {
    if (cacheKey) window.localStorage.setItem(CACHE_KEY_STORAGE, cacheKey);
    else window.localStorage.removeItem(CACHE_KEY_STORAGE);
  } catch {
    // storage unavailable: the cache key is fetched again next time
  }
}

function openLibrary(cacheKey: string) {
  if (library?.cacheKey === cacheKey) return;
  closeLibrary();
  const next = new AccountLibrary(cacheKey);
  library = next;
  mode = "account";
  unsubscribeLibrary = next.subscribe(emit);
  emit();
  void next.open().catch((error: unknown) => {
    console.error("The account cache couldn't be opened", error);
  });
}

function closeLibrary() {
  unsubscribeLibrary?.();
  unsubscribeLibrary = null;
  library?.close();
  library = null;
  mode = "signed-out";
  emit();
}

async function confirmAccount() {
  try {
    const response = await fetch("/api/account", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return;
    const body = (await response.json()) as { user?: unknown; cacheKey?: string };
    if (body.user && body.cacheKey) {
      rememberCacheKey(body.cacheKey);
      openLibrary(body.cacheKey);
    } else {
      rememberCacheKey(null);
      closeLibrary();
    }
  } catch {
    // Offline: keep whatever library is open.
  }
}

/** Starts once in the browser. Called by the hooks below. */
export function startAccountSession() {
  if (started || typeof window === "undefined") return;
  started = true;
  const cacheKey = storedCacheKey();
  if (hintSignedIn() && cacheKey) openLibrary(cacheKey);
  if (hintSignedIn()) void confirmAccount();
  window.addEventListener("eft-account-change", () => {
    if (hintSignedIn()) void confirmAccount();
    else closeLibrary();
  });
}

/** The open account library, or null when signed out. */
export function activeLibrary(): AccountLibrary | null {
  startAccountSession();
  return library;
}

function subscribe(listener: () => void) {
  startAccountSession();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The account library's current view, or null while signed out. */
export function useAccountView(): LibraryView | null {
  return useSyncExternalStore(
    subscribe,
    () => library?.view() ?? null,
    () => null
  );
}

export function useAccountMode(): Mode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => "signed-out"
  );
}

/**
 * Signing out (§12.7): the caller has already warned about unsynced changes. Deletes this account's
 * cache, tells other tabs, and forgets the cache key. The signed-out library is left as it is.
 */
export async function signOutOfAccountCache() {
  const current = library;
  if (!current) return;
  current.signedOut();
  closeLibrary();
  rememberCacheKey(null);
  await deleteAccountDb(current.cacheKey);
}

const noopSubscribe = () => () => undefined;

/**
 * Hydrated, and the library the page reads is loaded: at once when signed out (localStorage), and
 * once the account cache has been read when signed in. Library pages wait for it before saying
 * "not found".
 */
export function useLibraryHydrated() {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
  const view = useAccountView();
  return hydrated && (view === null || view.ready);
}
