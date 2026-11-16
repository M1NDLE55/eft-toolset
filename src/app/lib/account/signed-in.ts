"use client";

import { useSyncExternalStore } from "react";
import { SIGNED_IN_COOKIE } from "./cookies";

const ACCOUNT_CHANGE_EVENT = "eft-account-change";

function subscribe(listener: () => void) {
  window.addEventListener(ACCOUNT_CHANGE_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_CHANGE_EVENT, listener);
}

function readHint() {
  return document.cookie.split(";").some((part) => part.trim() === `${SIGNED_IN_COOKIE}=1`);
}

/** Whether this browser looks signed in, from the hint cookie. */
export function useSignedInHint() {
  return useSyncExternalStore(subscribe, readHint, () => false);
}

/** Call after a response may have changed the account cookies. */
export function announceAccountChange() {
  window.dispatchEvent(new Event(ACCOUNT_CHANGE_EVENT));
}
