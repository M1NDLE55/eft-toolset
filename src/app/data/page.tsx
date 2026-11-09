"use client";

import { useEffect, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useHydrated, useStore } from "@/app/lib/storage/use-store";
import {
  BACKUP_STORES,
  MAX_BACKUP_BYTES,
  applyRestore,
  countOf,
  createBackup,
  parseBackup,
  type RestorePlan,
} from "@/app/lib/storage/backup";
import { decodeSharePayload } from "@/app/lib/share-codec";
import { BACKUP_IMPORT_PARAM } from "@/app/lib/storage/store-keys";
import { cn } from "@/lib/utils";

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

/** The backup in a /data#import=… link, as made by the MCP endpoint's create_import_link. */
function useImportPayload() {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => ""
  );
  return new URLSearchParams(hash.replace(/^#/, "")).get(BACKUP_IMPORT_PARAM);
}

function clearImportHash() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function StoreCount({ index }: { index: number }) {
  const { label, definition } = BACKUP_STORES[index];
  const value = useStore(definition);
  const count = countOf(value);
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="text-[#ccc]">{label}</span>
      <span className="tabular-nums text-[#888]">{count === null ? "Saved" : count}</span>
    </li>
  );
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function Page() {
  const hydrated = useHydrated();
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const importPayload = useImportPayload();

  useEffect(() => {
    if (!importPayload) return;
    let cancelled = false;
    decodeSharePayload(importPayload)
      .then((value) => parseBackup(JSON.stringify(value)))
      .then(
        (parsed) => {
          if (cancelled) return;
          setPlan(parsed);
          setMessage({ tone: "ok", text: "Review the data from this link, then merge it into yours." });
        },
        (reason: unknown) => {
          if (cancelled) return;
          setMessage({
            tone: "error",
            text: reason instanceof Error ? `This import link can't be used: ${reason.message}` : "This import link is damaged.",
          });
        }
      );
    return () => {
      cancelled = true;
    };
  }, [importPayload]);

  const exportAll = () => {
    const backup = createBackup();
    download(JSON.stringify(backup, null, 2), `eft-toolset-backup-${backup.exportedAt.slice(0, 10)}.json`);
    setMessage({ tone: "ok", text: "Backup downloaded." });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setPlan(null);
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("This backup is larger than 10 MB.");
      setPlan(parseBackup(await file.text()));
      setMessage(null);
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not read this backup." });
    }
  };

  const restore = (mode: "merge" | "replace") => {
    if (!plan) return;
    try {
      applyRestore(plan, mode);
      setPlan(null);
      if (importPayload) clearImportHash();
      setMessage({ tone: "ok", text: mode === "merge" ? "Backup merged into your data." : "Your data was replaced with the backup." });
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not restore this backup." });
    }
  };

  return (
    <main className="flex flex-1 justify-center p-4 pb-12">
      <div className="flex w-full max-w-2xl flex-col gap-5">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Your data</h1>
          <p className="mt-1 text-sm text-[#888]">
            Everything you create is stored only in this browser. Back it up to a file to move it to another device or keep it safe.
          </p>
        </div>

        <section aria-labelledby="saved" className="flex flex-col gap-2">
          <h2 id="saved" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            Saved in this browser
          </h2>
          <ul className="divide-y divide-[#1a1a1a] border border-[#1a1a1a] bg-[#0c0c0c]">
            {hydrated
              ? BACKUP_STORES.map((store, index) => <StoreCount key={store.definition.key} index={index} />)
              : BACKUP_STORES.map((store) => (
                  <li key={store.definition.key} className="h-9 animate-shimmer" />
                ))}
          </ul>
        </section>

        <div className="flex flex-wrap gap-2">
          <Button onClick={exportAll} disabled={!hydrated}>
            <Download /> Download backup
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload /> Restore from file
              <input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void onFile(event)} />
            </label>
          </Button>
        </div>

        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cn(
              "border px-3 py-2 text-sm",
              message.tone === "error"
                ? "border-red-900/60 bg-red-950/30 text-red-200"
                : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200"
            )}
          >
            {message.text}
          </p>
        )}

        {plan && (
          <section aria-labelledby="restore" className="flex flex-col gap-3 border border-[#3a3326] bg-[#100f0c] p-4">
            <h2 id="restore" className="text-xs font-bold uppercase tracking-widest text-[#c8b384]">
              Restore backup{plan.exportedAt ? ` from ${new Date(plan.exportedAt).toLocaleString()}` : ""}
            </h2>
            <ul className="flex flex-col gap-1 text-sm text-[#ccc]">
              {plan.entries.map((entry) => (
                <li key={entry.key} className="flex justify-between gap-3">
                  <span>{entry.label}</span>
                  <span className="tabular-nums text-[#888]">{entry.count === null ? "Setting" : entry.count}</span>
                </li>
              ))}
            </ul>
            {plan.rejected.length > 0 && (
              <p className="text-xs text-amber-200">Skipped because they failed validation: {plan.rejected.join(", ")}.</p>
            )}
            <p className="text-xs text-[#999]">
              Merge adds groups, builds, plans, and recent items you don&apos;t already have and keeps your settings. Replace overwrites everything listed above.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => restore("merge")}>Merge</Button>
              <ConfirmDialog
                trigger={<Button variant="outline" className="text-red-300 hover:text-red-200">Replace</Button>}
                title="Replace your data?"
                description="The listed data in this browser will be overwritten by the backup. This cannot be undone."
                confirmLabel="Replace"
                onConfirm={() => restore("replace")}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setPlan(null);
                  if (importPayload) clearImportHash();
                }}
              >
                Cancel
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
