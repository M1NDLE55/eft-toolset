"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { readStore, writeStores, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { STORE_KEYS } from "@/app/lib/storage/store-keys";
import { BUILD_STORE } from "@/app/lib/builds/store";
import { GROUP_STORE } from "@/app/lib/item-groups/store";
import { PLAN_STORE } from "@/app/lib/raid-planner/store";
import { activeLibrary, useAccountView } from "@/app/lib/account-sync/account-session";
import { chunk, migrationCandidates, preselect, selectionKey, type MigrationCandidate, type MigrationType } from "@/app/lib/account-sync/migration";
import type { LibrarySnapshot } from "@/app/lib/sharing/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Move your browser library to your account?" (§14.5). Offered once per account on this browser
 * when the signed-out library holds anything; Settings → Data in this browser opens it again.
 * What moved (or was already in the account) is removed from the browser; the rest stays.
 */
export const MOVABLE_TYPES: readonly MigrationType[] = ["build", "item_group", "plan"];

const TYPE_LABEL: Record<MigrationType, string> = { build: "Builds", item_group: "Item groups", plan: "Raid plans" };
const DISMISSED_PREFIX = "eft-toolset:migration-offered:";

let requested = false;
const openListeners = new Set<() => void>();

/** Opens the dialog (from Settings). */
export function openLibraryMigration() {
  requested = true;
  for (const listener of openListeners) listener();
}

function useOpenRequests() {
  return useSyncExternalStore(
    (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    () => requested,
    () => false
  );
}

/** What the signed-out library holds. Groups count only once someone has saved them (not the defaults). */
export function readBrowserLibrary() {
  let groupsSaved = false;
  try {
    groupsSaved = window.localStorage.getItem(STORE_KEYS.itemGroups) !== null;
  } catch {
    groupsSaved = false;
  }
  return { builds: readStore(BUILD_STORE), groups: groupsSaved ? readStore(GROUP_STORE) : [], plans: readStore(PLAN_STORE) };
}

function offered(cacheKey: string) {
  try {
    return window.localStorage.getItem(`${DISMISSED_PREFIX}${cacheKey}`) !== null;
  } catch {
    return true;
  }
}

function markOffered(cacheKey: string) {
  try {
    window.localStorage.setItem(`${DISMISSED_PREFIX}${cacheKey}`, String(Date.now()));
  } catch {
    // storage unavailable
  }
}

type ImportResult = { index: number; status: string; id?: string; message?: string };

export function LibraryMigration() {
  const view = useAccountView();
  const requestedOpen = useOpenRequests();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [candidates, setCandidates] = useState<MigrationCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const library = view?.ready ? activeLibrary() : null;

  useEffect(() => {
    if (!library) return;
    const shouldOffer = requestedOpen || !offered(library.cacheKey);
    if (!shouldOffer) return;
    const browser = readBrowserLibrary();
    if (!requestedOpen && browser.builds.length + browser.groups.length + browser.plans.length === 0) {
      markOffered(library.cacheKey);
      return;
    }
    let active = true;
    void library
      .request("/api/library")
      .then(async (response) => {
        if (!response.ok) throw new Error("Your account library couldn't be loaded.");
        const next = (await response.json()) as LibrarySnapshot;
        if (!active) return;
        const found = migrationCandidates(browser, next.hashes).filter((candidate) => MOVABLE_TYPES.includes(candidate.type));
        if (found.length === 0 && !requestedOpen) {
          markOffered(library.cacheKey);
          return;
        }
        setSnapshot(next);
        setCandidates(found);
        setSelected(preselect(found, roomOf(next)));
        setReport(null);
        setError(null);
        setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [library, requestedOpen]);

  const room = useMemo(() => (snapshot ? roomOf(snapshot) : null), [snapshot]);

  function close() {
    if (library) markOffered(library.cacheKey);
    requested = false;
    for (const listener of openListeners) listener();
    setOpen(false);
  }

  async function move() {
    if (!library) return;
    setBusy(true);
    setError(null);
    const chosen = candidates.filter((candidate) => selected.has(selectionKey(candidate)));
    let moved = 0;
    let skipped = 0;
    const failures: string[] = [];
    try {
      for (const batch of chunk(chosen, 50)) {
        const response = await library.request("/api/library/import", {
          method: "POST",
          body: JSON.stringify({ origin: "migration", items: batch.map((candidate) => ({ type: candidate.type, value: candidate.value })) }),
        });
        if (!response.ok) throw new Error(response.status === 429 ? "Too many imports today. Try again tomorrow." : "Moving stopped partway. Try again: nothing moves twice.");
        const { results } = (await response.json()) as { results: ImportResult[] };
        const done = new Set<string>();
        for (const result of results) {
          const candidate = batch[result.index];
          if (!candidate) continue;
          if (result.status === "created" || result.status === "duplicate") {
            done.add(selectionKey(candidate));
            if (result.status === "created") moved += 1;
            else skipped += 1;
          } else {
            failures.push(`${candidate.name}: ${result.message ?? result.status}`);
          }
        }
        removeFromBrowser(batch.filter((candidate) => done.has(selectionKey(candidate))));
      }
      setReport(
        [`Moved ${moved} item${moved === 1 ? "" : "s"} to your account.`, skipped ? `${skipped} were already there.` : "", failures.length ? `Left in this browser: ${failures.join("; ")}` : ""]
          .filter(Boolean)
          .join(" ")
      );
      await library.catchUp();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Moving stopped partway. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !room) return null;
  const blocked = candidates.filter((candidate) => candidate.blocked);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Move your browser library to your account?</DialogTitle>
          <DialogDescription>
            Your account keeps them on every device you sign in on. Anything you leave stays in this browser, under Settings → Data in this browser.
          </DialogDescription>
        </DialogHeader>
        {report ? (
          <p role="status" className="text-sm text-[#ccc]">
            {report}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {MOVABLE_TYPES.map((type) => {
              const items = candidates.filter((candidate) => candidate.type === type && !candidate.blocked).sort((a, b) => b.updatedAt - a.updatedAt);
              if (items.length === 0) return null;
              const chosen = items.filter((candidate) => selected.has(selectionKey(candidate))).length;
              return (
                <fieldset key={type} className="flex flex-col gap-2 border border-[#1a1a1a] p-3">
                  <legend className="px-1 text-3xs font-bold uppercase tracking-widest text-[#c8b384]">{TYPE_LABEL[type]}</legend>
                  <p className="text-xs text-[#999]">
                    {chosen} of {items.length} selected · room for {Math.max(0, room[type])} more in your account
                  </p>
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {items.map((candidate) => {
                      const key = selectionKey(candidate);
                      const checked = selected.has(key);
                      const full = !checked && chosen >= room[type];
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm text-[#ccc]">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={full || busy}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                          />
                          <span className="truncate">{candidate.name || "Untitled"}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
            {blocked.length > 0 && (
              <p className="text-xs text-[#999]">
                {blocked.length} plan{blocked.length === 1 ? " is" : "s are"} bigger than an account plan can hold and will stay in this browser:{" "}
                {blocked.map((candidate) => candidate.name).join(", ")}.
              </p>
            )}
            {candidates.length === 0 && <p className="text-sm text-[#888]">Everything in this browser is already in your account.</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          {report ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={busy}>
                Not now
              </Button>
              <Button onClick={() => void move()} disabled={busy || selected.size === 0}>
                {busy ? "Moving…" : "Move to your account"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function roomOf(snapshot: LibrarySnapshot): Record<MigrationType, number> {
  return {
    build: snapshot.limits.builds - snapshot.usage.builds,
    item_group: snapshot.limits.itemGroups - snapshot.usage.itemGroups,
    plan: snapshot.limits.ownedPlans - snapshot.usage.ownedPlans,
  };
}

/** Removes moved and duplicate items from the signed-out library, in one write. */
function removeFromBrowser(done: MigrationCandidate[]) {
  if (done.length === 0) return;
  const builds = new Set(done.filter((item) => item.type === "build").map((item) => item.key));
  const groups = new Set(done.filter((item) => item.type === "item_group").map((item) => item.key));
  const plans = new Set(done.filter((item) => item.type === "plan").map((item) => item.key));
  const entries: { definition: StoreDefinition<unknown>; value: unknown }[] = [];
  if (builds.size) entries.push({ definition: BUILD_STORE as StoreDefinition<unknown>, value: readStore(BUILD_STORE).filter((build) => !builds.has(build.id)) });
  if (groups.size) entries.push({ definition: GROUP_STORE as StoreDefinition<unknown>, value: readStore(GROUP_STORE).filter((group) => !groups.has(group.name)) });
  if (plans.size) entries.push({ definition: PLAN_STORE as StoreDefinition<unknown>, value: readStore(PLAN_STORE).filter((plan) => !plans.has(plan.id)) });
  writeStores(entries);
}
