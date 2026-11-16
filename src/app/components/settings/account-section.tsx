"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { announceAccountChange } from "@/app/lib/account/signed-in";
import { cn } from "@/lib/utils";

interface AccountUser {
  email: string;
  name: string | null;
  createdAt: string;
}

type AccountState =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "signed_out" }
  | { kind: "signed_in"; user: AccountUser }
  | { kind: "error"; message: string };

type Notice = { tone: "ok" | "error"; text: string } | null;

const RETURN_NOTICES: Record<string, Notice> = {
  "signed-in": { tone: "ok", text: "You're signed in." },
  error: { tone: "error", text: "Sign-in didn't finish. Try again." },
  busy: { tone: "error", text: "Too many requests. Wait a moment and try again." },
};

/** Reads ?account=… left by the sign-in routes once, then drops it from the address bar. */
function takeReturnNotice(): Notice {
  const url = new URL(window.location.href);
  const outcome = url.searchParams.get("account");
  if (!outcome) return null;
  url.searchParams.delete("account");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return RETURN_NOTICES[outcome] ?? null;
}

async function loadAccount(): Promise<AccountState> {
  try {
    const response = await fetch("/api/account", { cache: "no-store" });
    const body = (await response.json()) as { configured?: boolean; user?: AccountUser | null; error?: string };
    if (!response.ok) return { kind: "error", message: body.error ?? "Your account can't be checked right now." };
    if (!body.configured) return { kind: "off" };
    return body.user ? { kind: "signed_in", user: body.user } : { kind: "signed_out" };
  } catch {
    return { kind: "error", message: "Your account can't be checked right now." };
  } finally {
    announceAccountChange();
  }
}

export function AccountSection() {
  const [state, setState] = useState<AccountState>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    const returned = takeReturnNotice();
    void loadAccount().then((next) => {
      if (!active) return;
      setState(next);
      if (returned) setNotice(returned);
    });
    return () => {
      active = false;
    };
  }, []);

  const signOut = async () => {
    setPending(true);
    try {
      const response = await fetch("/api/account/sign-out", { method: "POST" });
      const body = (await response.json()) as { url?: string; error?: string };
      announceAccountChange();
      if (!response.ok || !body.url) throw new Error(body.error ?? "You couldn't be signed out. Try again.");
      window.location.assign(body.url);
    } catch (reason) {
      setPending(false);
      setNotice({ tone: "error", text: reason instanceof Error ? reason.message : "You couldn't be signed out. Try again." });
    }
  };

  const deleteAccount = async () => {
    setPending(true);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      announceAccountChange();
      if (!response.ok) throw new Error(body.error ?? "Your account couldn't be deleted. Try again.");
      setState({ kind: "signed_out" });
      setNotice({ tone: "ok", text: "Your account was deleted." });
    } catch (reason) {
      setNotice({ tone: "error", text: reason instanceof Error ? reason.message : "Your account couldn't be deleted. Try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {state.kind === "loading" && <div className="h-24 border border-[#1a1a1a] bg-[#0c0c0c] animate-shimmer" aria-busy />}

      {state.kind === "off" && (
        <p className="border border-[#1a1a1a] bg-[#0c0c0c] px-4 py-3 text-sm text-[#888]">Accounts aren&apos;t set up on this server.</p>
      )}

      {state.kind === "error" && (
        <p role="alert" className="border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {state.message}
        </p>
      )}

      {state.kind === "signed_out" && (
        <div className="flex flex-col gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
          <p className="text-sm text-[#bbb]">
            You&apos;re not signed in. Sign in to connect an AI assistant or to manage the account your assistant created.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="/auth/sign-in">
                <LogIn /> Sign in
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/auth/sign-in?screen=sign-up">
                <UserPlus /> Create account
              </a>
            </Button>
          </div>
        </div>
      )}

      {state.kind === "signed_in" && (
        <div className="flex flex-col gap-4 border border-[#1a1a1a] bg-[#0c0c0c] p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#3a3326] text-[#c8b384]">
              <UserRound className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-bold text-[#ddd]">{state.user.name ?? state.user.email}</span>
              {state.user.name && <span className="truncate text-sm text-[#999]">{state.user.email}</span>}
              <span className="text-xs text-[#777]">
                Member since {new Date(state.user.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void signOut()} disabled={pending}>
              <LogOut /> Sign out
            </Button>
          </div>
          <div className="flex flex-col gap-2 border-t border-[#1a1a1a] pt-4">
            <p className="text-xs text-[#888]">
              Deleting your account signs you out everywhere and ends your AI assistants&apos; access. Your data in this browser is kept.
            </p>
            <ConfirmDialog
              trigger={
                <Button variant="outline" className="self-start text-red-300 hover:text-red-200" disabled={pending}>
                  Delete account
                </Button>
              }
              title="Delete your account?"
              description="Your EFT Toolset account is deleted and your AI assistants lose access. Groups, builds and plans in this browser are kept. This cannot be undone."
              confirmLabel="Delete account"
              onConfirm={() => void deleteAccount()}
            />
          </div>
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "border px-3 py-2 text-sm",
            notice.tone === "error" ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200"
          )}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
