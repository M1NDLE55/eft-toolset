"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, Download, LoaderCircle, LogIn } from "lucide-react";
import Link from "@/app/lib/navigation/link";
import { useRouter } from "@/app/lib/navigation/hooks";
import { Button } from "@/components/ui/button";
import { SharedBuildPreview } from "@/app/gun-builder/share/share-page";
import { createBuild } from "@/app/lib/builds/store";
import { addGroupItem, createGroup } from "@/app/lib/item-groups/store";
import { useAccountMode } from "@/app/lib/account-sync/account-session";
import type { BuildValue, GroupValue } from "@/app/lib/sharing/types";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { SharePreview } from "./share.server";
import { importPlan } from "@/app/lib/raid-planner/store";
import { SharedPlanView } from "./shared-plan-view";

/** Why a link didn't open, or why saving a copy after sign-in failed (?error=…). */
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "This link doesn't exist. Check you copied all of it.",
  gone: "This link no longer works: it was revoked, expired, or what it pointed to was deleted.",
  forbidden: "The owner doesn't allow copies of this.",
  limit: "Your library is full. Delete something to make room, then try again.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  invalid: "Something went wrong. Try again.",
};

function readError() {
  return new URLSearchParams(window.location.search).get("error");
}

/**
 * /s/<code>: a view or copy link to a build, item group or raid plan (§7.4, §14.1). Anyone can look,
 * without an account. With a copy link, a signed-in visitor saves a copy to their account; a
 * signed-out visitor can save it to this browser, or sign in and have the copy made on return.
 */
export function ShareLinkPage({ preview, code }: { preview: SharePreview; code: string }) {
  const returnError = useSyncExternalStore(
    () => () => undefined,
    readError,
    () => null
  );
  if (!preview.ok) {
    const paused = preview.code === "forbidden" && /review/i.test(preview.message);
    return (
      <main className="flex flex-1 justify-center p-4">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-[#c8b384]" />
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">{paused ? "Under review" : "Can't open link"}</h1>
          <p className="text-sm text-[#888]">{paused ? "This link is under review." : preview.message || ERROR_MESSAGES[preview.code]}</p>
          <Button asChild variant="outline">
            <Link href="/">Go to EFT Toolset</Link>
          </Button>
        </div>
      </main>
    );
  }
  const { share } = preview;
  const actions = <ShareActions code={code} share={share} />;
  const banner = returnError ? (
    <p role="alert" className="border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
      {ERROR_MESSAGES[returnError] ?? ERROR_MESSAGES.invalid}
    </p>
  ) : null;
  const footer = (
    <div className="flex items-center justify-between gap-2 text-xs text-[#777]">
      <span>Shared by {share.ownerDisplayName}</span>
    </div>
  );

  if (share.targetType === "plan") {
    return <SharedPlanView code={code} share={share} plan={share.snapshot as PlanContent} actions={actions} banner={banner} footer={footer} />;
  }
  return (
    <main className="flex min-w-0 flex-1 justify-center p-4 pb-10">
      <div className="flex w-full max-w-xl flex-col gap-4">
        {banner}
        {share.targetType === "build" ? (
          <SharedBuildPreview build={{ ...(share.snapshot as BuildValue), ammoId: (share.snapshot as BuildValue).ammoId ?? null }} actions={actions} />
        ) : (
          <SharedGroup group={share.snapshot as GroupValue} actions={actions} />
        )}
        {footer}
      </div>
    </main>
  );
}

function SharedGroup({ group, actions }: { group: GroupValue; actions: ReactNode }) {
  return (
    <>
      <p className="text-2xs font-bold uppercase tracking-widest text-[#9a8866]">Shared item group</p>
      <div className="border border-[#1a1a1a] bg-[#0c0c0c] p-3">
        <h1 className="truncate text-xl font-black uppercase tracking-widest text-[#e6d9b8]">{group.name}</h1>
        <p className="text-sm text-[#888]">
          {group.items.length} item{group.items.length === 1 ? "" : "s"}
        </p>
      </div>
      {actions}
      <ul className="border border-[#1a1a1a] bg-[#0c0c0c]">
        {group.items.map((item) => (
          <li key={item} className="border-t border-[#141414] px-3 py-1.5 text-sm text-[#ddd] first:border-t-0">
            <Link href={`/item/${encodeURIComponent(item)}`} className="hover:text-[#e6d9b8] hover:underline">
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ShareActions({ code, share }: { code: string; share: Extract<SharePreview, { ok: true }>["share"] }) {
  const router = useRouter();
  const mode = useAccountMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (share.access !== "copy") {
    return <p className="text-xs text-[#888]">{share.allowCopy ? "This is a view link." : "The owner doesn't allow copies of this."}</p>;
  }

  async function saveToAccount() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/s/${code}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await response.json()) as { url?: string; error?: { message: string } };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "The copy couldn't be saved.");
      router.push(body.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The copy couldn't be saved.");
      setBusy(false);
    }
  }

  /** Signs in first; the callback makes the copy and lands on it (§15). The code goes in the body. */
  async function signInToSave() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "copy", code }) });
      const body = (await response.json()) as { url?: string; error?: { message: string } };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Sign-in couldn't start.");
      window.location.assign(body.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in couldn't start.");
      setBusy(false);
    }
  }

  function saveToBrowser() {
    setError("");
    try {
      if (share.targetType === "build") {
        const build = share.snapshot as BuildValue;
        const created = createBuild(build.name, build.weaponId, build.root, build.ammoId ?? null);
        router.push(`/gun-builder/${created.id}`);
      } else if (share.targetType === "item_group") {
        const group = share.snapshot as GroupValue;
        let name = group.name;
        for (let index = 2; ; index += 1) {
          try {
            name = createGroup(name);
            break;
          } catch (reason) {
            if (index > 50 || !(reason instanceof Error) || !/already exists/.test(reason.message)) throw reason;
            name = `${group.name.slice(0, 110)} (${index})`;
          }
        }
        for (const item of group.items) addGroupItem(name, item);
        router.push(`/item-groups/${encodeURIComponent(name)}`);
      } else {
        const plan = share.snapshot as PlanContent;
        const created = importPlan({ name: plan.name, mapKey: plan.mapKey, enabledLayers: plan.enabledLayers, route: plan.route, drawings: plan.drawings, notes: plan.notes });
        router.push(`/raid-planner/${created.id}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "It couldn't be saved to this browser.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {mode === "account" ? (
          <Button onClick={() => void saveToAccount()} disabled={busy} className="sm:flex-1">
            {busy ? <LoaderCircle className="animate-spin" /> : <Download />} Save a copy
          </Button>
        ) : (
          <>
            <Button onClick={() => void signInToSave()} disabled={busy} className="sm:flex-1">
              {busy ? <LoaderCircle className="animate-spin" /> : <LogIn />} Save a copy to my account
            </Button>
            <Button variant="outline" onClick={saveToBrowser} disabled={busy}>
              Save to this browser
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
