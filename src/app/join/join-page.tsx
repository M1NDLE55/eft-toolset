"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, LoaderCircle, LogIn, Users } from "lucide-react";
import { useRouter } from "@/app/lib/navigation/hooks";
import Link from "@/app/lib/navigation/link";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { useAccountMode } from "@/app/lib/account-sync/account-session";
import { Button } from "@/components/ui/button";

interface InvitePreview {
  name: string;
  mapKey: string;
  role: "editor" | "viewer";
  inviter: string;
  expiresAt: number | null;
}

const ERRORS: Record<string, string> = {
  not_found: "This invite doesn't exist. Check you copied all of it.",
  gone: "This invite no longer works: it was revoked, has expired, or has been used.",
  limit: "You can't join: you're in too many plans, or this plan is full.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  forbidden: "This invite can't be used.",
  invalid: "Something went wrong. Try again.",
};

function readCode() {
  return window.location.hash.replace(/^#/, "").slice(0, 32);
}

function readError() {
  return new URLSearchParams(window.location.search).get("error");
}

const subscribeHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

/**
 * /join#<code> (§7.3, §14.2): an invite to a raid plan. The code stays in the fragment, so it never
 * reaches server logs, analytics or Referer; the page sends it in a POST body. Joining needs an
 * account: a signed-out visitor signs in first and the invite is accepted on the way back.
 */
export function JoinPage() {
  const router = useRouter();
  const mode = useAccountMode();
  const code = useSyncExternalStore(subscribeHash, readCode, () => "");
  const returnedError = useSyncExternalStore(() => () => undefined, readError, () => null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    fetch("/api/invites/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      .then(async (response) => {
        const body = (await response.json()) as InvitePreview & { error?: { code: string; message: string } };
        if (!active) return;
        if (!response.ok) setError(body.error?.message ?? ERRORS.invalid);
        else setPreview(body);
      })
      .catch(() => active && setError("The invite couldn't be checked. Are you online?"));
    return () => {
      active = false;
    };
  }, [code]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "account") {
        const response = await fetch("/api/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        const body = (await response.json()) as { url?: string; error?: { message: string } };
        if (!response.ok || !body.url) throw new Error(body.error?.message ?? ERRORS.invalid);
        router.push(body.url);
        return;
      }
      const response = await fetch("/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "join", code }) });
      const body = (await response.json()) as { url?: string; error?: { message: string } };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Sign-in couldn't start.");
      window.location.assign(body.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ERRORS.invalid);
      setBusy(false);
    }
  }

  const failure = error ?? (returnedError ? (ERRORS[returnedError] ?? ERRORS.invalid) : null);
  return (
    <main className="flex flex-1 justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-4 py-12">
        <p className="text-2xs font-bold uppercase tracking-widest text-[#9a8866]">Invite</p>
        {!code && <p className="text-sm text-[#888]">This invite link is missing its code. Make sure you copied the whole link.</p>}
        {code && !preview && !failure && <div className="h-32 animate-pulse border border-[#1a1a1a] bg-[#0c0c0c]" aria-busy />}
        {preview && (
          <div className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
            <h1 className="text-xl font-black uppercase tracking-widest text-[#e6d9b8]">{preview.name}</h1>
            <p className="text-sm text-[#999]">
              {getMapConfig(preview.mapKey)?.name ?? preview.mapKey} · {preview.inviter} invited you as {preview.role === "editor" ? "an editor" : "a viewer"}
            </p>
            {preview.expiresAt && <p className="text-xs text-[#777]">Invite expires {new Date(preview.expiresAt).toLocaleString()}.</p>}
            <Button onClick={() => void join()} disabled={busy} className="mt-2">
              {busy ? <LoaderCircle className="animate-spin" /> : mode === "account" ? <Users /> : <LogIn />}
              {mode === "account" ? `Join as ${preview.role}` : `Sign in to join as ${preview.role}`}
            </Button>
          </div>
        )}
        {failure && (
          <p role="alert" className="flex items-start gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {failure}
          </p>
        )}
        <Link href="/raid-planner" className="text-xs text-[#888] hover:text-[#ccc]">
          Go to the raid planner
        </Link>
      </div>
    </main>
  );
}
