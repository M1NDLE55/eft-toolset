"use client";

import { useState } from "react";
import { activeLibrary } from "@/app/lib/account-sync/account-session";
import { LinksPanel, type LinkTarget } from "./links-panel";

/** The links panel for a build or item group in the account, with its "Allow copies" setting. */
export function AccountItemLinks({ target, allowCopy, online }: { target: LinkTarget & { type: "build" | "item_group" }; allowCopy: boolean; online: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState<boolean | null>(null);
  async function change(allow: boolean) {
    const library = activeLibrary();
    if (!library) return;
    setPending(allow);
    setError("");
    try {
      const path = `/api/library/${target.type === "build" ? "builds" : "item-groups"}/${encodeURIComponent(target.id)}/settings`;
      const response = await library.request(path, { method: "PATCH", body: JSON.stringify({ allowCopy: allow }) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? "Couldn't change that.");
      await library.catchUp();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't change that.");
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <LinksPanel target={target} allowCopy={pending ?? allowCopy} onAllowCopyChange={change} online={online} />
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </>
  );
}
