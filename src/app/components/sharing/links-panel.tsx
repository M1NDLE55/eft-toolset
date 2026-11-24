"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, Trash2 } from "lucide-react";
import { copyText } from "@/app/lib/browser/clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The links to one account item (§7): create view and copy links (and, for plans, invites), see
 * their status, opens and uses, copy and revoke them. Owners see all of a plan's links; editors see
 * and make only their own viewer invites. Builds and groups have only view and copy links.
 */
export type LinkTarget = { type: "build" | "item_group" | "plan"; id: string };

export interface LinkInfo {
  code: string;
  url: string;
  access: "view" | "copy" | "invite";
  role?: "editor" | "viewer" | null;
  status: "active" | "expired" | "revoked" | "paused" | "used";
  createdAt: number;
  expiresAt: number | null;
  opens?: number;
  copies?: number;
  uses?: number;
  maxUses?: number | null;
}

const VIEW_EXPIRY = [
  { label: "Never expires", value: null },
  { label: "1 day", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
] as const;

const INVITE_EXPIRY = [
  { label: "1 hour", value: 1 / 24 },
  { label: "1 day", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
] as const;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Something went wrong. Try again.");
  return body;
}

export function LinksPanel({
  target,
  role = "owner",
  allowCopy,
  onAllowCopyChange,
  online = true,
}: {
  target: LinkTarget;
  role?: "owner" | "editor" | "viewer";
  allowCopy: boolean;
  onAllowCopyChange?: (allow: boolean) => Promise<void> | void;
  online?: boolean;
}) {
  const [links, setLinks] = useState<LinkInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<"view" | "copy" | "invite">(role === "owner" ? (target.type === "plan" ? "invite" : "copy") : "invite");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [maxUses, setMaxUses] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const owner = role === "owner";
  const canCreate = owner || (role === "editor" && target.type === "plan");

  const [reloads, setReloads] = useState(0);
  const load = () => setReloads((count) => count + 1);

  useEffect(() => {
    if (!online) return;
    let active = true;
    api<{ links: LinkInfo[] }>(`/api/links?type=${target.type}&id=${encodeURIComponent(target.id)}`)
      .then((body) => {
        if (!active) return;
        setLinks(body.links);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Links couldn't be loaded.");
      });
    return () => {
      active = false;
    };
  }, [target.type, target.id, online, reloads]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const invite = access === "invite";
      await api("/api/links", {
        method: "POST",
        body: JSON.stringify({
          target,
          access,
          ...(invite ? { role: owner ? inviteRole : "viewer", maxUses, expiresIn: expiry ?? 7 } : { expiresIn: expiry }),
        }),
      });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link couldn't be made.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code: string) {
    setBusy(true);
    try {
      await api(`/api/links/${code}`, { method: "DELETE" });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link couldn't be revoked.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await copyText(url);
      setCopied(url);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy the link.");
    }
  }

  if (!online) return <p className="text-xs text-[#888]">Links need a connection.</p>;
  const choices = target.type === "plan" ? (owner ? (["invite", "view", "copy"] as const) : (["invite"] as const)) : (["copy", "view"] as const);
  const expiries = access === "invite" ? INVITE_EXPIRY : VIEW_EXPIRY;
  const active = (links ?? []).filter((link) => link.status === "active" || link.status === "paused");
  const inactive = (links ?? []).filter((link) => !active.includes(link));

  return (
    <div className="flex flex-col gap-3">
      {owner && onAllowCopyChange && (
        <label className="flex items-start gap-2 text-sm text-[#ccc]">
          <input type="checkbox" className="mt-1" checked={allowCopy} onChange={(event) => void onAllowCopyChange(event.target.checked)} />
          <span>
            Allow copies
            <span className="block text-xs text-[#888]">
              Anyone who can see it could still recreate it by hand; this states your wishes and the site respects them.
            </span>
          </span>
        </label>
      )}

      {canCreate && (
        <div className="flex flex-col gap-2 border border-[#1a1a1a] bg-[#080808] p-3">
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setAccess(choice);
                  setExpiry(choice === "invite" ? 7 : null);
                }}
                className={cn(
                  "border px-2 py-1 text-3xs font-bold uppercase tracking-widest",
                  access === choice ? "border-[#9a8866] text-[#e6d9b8]" : "border-[#2a2a2a] text-[#888] hover:text-[#ccc]"
                )}
              >
                {choice === "invite" ? "Invite" : choice === "copy" ? "Copy link" : "View link"}
              </button>
            ))}
          </div>
          <p className="text-xs text-[#888]">
            {access === "invite"
              ? "Makes whoever opens it a member. They need an account."
              : access === "copy"
                ? allowCopy
                  ? "Anyone with the link can see it and save their own copy. No account needed to look."
                  : "Copies are off, so this works as a view link until you allow copies."
                : "Anyone with the link can see it. No account needed."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {access === "invite" && owner && (
              <select aria-label="Role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")} className="h-9 border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-xs text-[#ddd]">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
            )}
            <select
              aria-label="Expires"
              value={String(expiry)}
              onChange={(event) => setExpiry(event.target.value === "null" ? null : Number(event.target.value))}
              className="h-9 border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-xs text-[#ddd]"
            >
              {expiries.map((option) => (
                <option key={option.label} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
            {access === "invite" && (
              <label className="flex items-center gap-1 text-xs text-[#999]">
                Uses
                <Input type="number" min={1} max={50} value={maxUses} onChange={(event) => setMaxUses(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} className="h-9 w-16" />
              </label>
            )}
            <Button size="sm" onClick={() => void create()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Link2 />} Create
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {links === null && !error && <p className="text-xs text-[#888]">Loading links…</p>}
      {active.length > 0 && (
        <ul className="flex flex-col gap-2">
          {active.map((link) => (
            <li key={link.code} className="flex flex-col gap-1 border border-[#1a1a1a] p-2">
              <div className="flex items-center gap-2">
                <span className="text-3xs font-bold uppercase tracking-widest text-[#c8b384]">
                  {link.access === "invite" ? `Invite · ${link.role}` : link.access === "copy" ? "Copy link" : "View link"}
                </span>
                {link.status === "paused" && <span className="text-3xs uppercase tracking-widest text-amber-300">Under review</span>}
                <span className="ml-auto text-3xs text-[#777]">
                  {link.access === "invite" ? `${link.uses ?? 0}/${link.maxUses ?? "∞"} used` : `${link.opens ?? 0} opens · ${link.copies ?? 0} copies`}
                  {link.expiresAt ? ` · until ${new Date(link.expiresAt).toLocaleDateString()}` : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <Input readOnly value={link.url} aria-label="Link" onFocus={(event) => event.currentTarget.select()} className="h-9 font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => void copy(link.url)} aria-label="Copy link">
                  {copied === link.url ? <Check /> : <Copy />}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void revoke(link.code)} disabled={busy} aria-label="Revoke link" title="Revoke">
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {inactive.length > 0 && (
        <details className="text-xs text-[#888]">
          <summary className="cursor-pointer">{inactive.length} expired or revoked</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {inactive.map((link) => (
              <li key={link.code}>
                {link.access} · {link.status} · made {new Date(link.createdAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
