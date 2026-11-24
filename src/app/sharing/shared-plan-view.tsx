"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import ReconnectingWebSocket from "partysocket/ws";
import { Eye } from "lucide-react";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { applyOps, docFromContent, toRaidPlan, type PlanDoc } from "@/app/lib/sharing/plan-doc";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { ServerMessage } from "@/app/lib/durable/live-protocol";
import { PlanEditor } from "@/app/components/raid-planner/plan-editor";
import { overlayPanel } from "@/app/components/raid-planner/ui";
import { cn } from "@/lib/utils";
import type { SharePreview } from "./share.server";

/**
 * A raid plan behind a view or copy link (§7.4, §8.1): read-only, updating live for anyone with the
 * link, with no account. Past 200 anonymous viewers the socket is refused, and the page polls the
 * cached snapshot every 15 seconds instead (§9.3). Nothing is cached in the browser.
 */
class AnonymousViewer {
  doc: PlanDoc;
  rev: number;
  watching = 0;
  live = false;
  ended: string | null = null;
  private listeners = new Set<() => void>();
  private socket: ReconnectingWebSocket | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private version = 0;

  constructor(
    readonly code: string,
    content: PlanContent,
    rev: number
  ) {
    this.doc = docFromContent(content, null, rev);
    this.rev = rev;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion = () => this.version;

  private notify() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  start() {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new ReconnectingWebSocket(() => `${scheme}//${location.host}/api/s/${this.code}/live?since=${this.rev}`, [], {
      maxEnqueuedMessages: 0,
      maxRetries: 3,
      shouldReconnectOnClose: (event) => event.code !== 4010 && event.code !== 4004,
    });
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.failures = 0;
      this.live = true;
      this.stopPolling();
      this.notify();
    });
    socket.addEventListener("close", (event) => {
      this.live = false;
      if (event.code === 4010 || event.code === 4004) {
        this.ended = event.code === 4004 ? "This plan was deleted." : "This link no longer works.";
        socket.close();
      } else if ((this.failures += 1) >= 3) {
        // Refused (the viewer cap) or unreachable: poll the cached snapshot instead.
        this.startPolling();
      }
      this.notify();
    });
    socket.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "snapshot") {
        this.doc = message.doc;
        this.rev = message.rev;
        this.watching = message.anonymous;
      } else if (message.type === "ops" && message.rev === this.rev + 1) {
        this.doc = applyOps(this.doc, message.ops, { rev: message.rev, by: null, maxOps: Number.POSITIVE_INFINITY }).doc;
        this.rev = message.rev;
      } else if (message.type === "ops" && message.rev > this.rev + 1) {
        socket.reconnect();
      } else if (message.type === "presence") {
        this.watching = message.anonymous;
      }
      this.notify();
    });
  }

  private startPolling() {
    if (this.poll) return;
    this.poll = setInterval(async () => {
      const response = await fetch(`/api/s/${this.code}`).catch(() => null);
      if (!response) return;
      if (!response.ok) {
        this.ended = "This link no longer works.";
        this.stopPolling();
        this.notify();
        return;
      }
      const body = (await response.json()) as { snapshot: PlanContent; rev?: number };
      this.doc = docFromContent(body.snapshot, null, body.rev ?? this.rev);
      this.rev = body.rev ?? this.rev;
      this.notify();
    }, 15_000);
  }

  private stopPolling() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  stop() {
    this.stopPolling();
    this.socket?.close();
  }
}

export function SharedPlanView({
  code,
  share,
  plan,
  actions,
  banner,
  footer,
}: {
  code: string;
  share: Extract<SharePreview, { ok: true }>["share"];
  plan: PlanContent;
  actions: ReactNode;
  banner: ReactNode;
  footer: ReactNode;
}) {
  const viewer = useMemo(() => new AnonymousViewer(code, plan, share.rev ?? 0), [code, plan, share.rev]);
  useEffect(() => {
    viewer.start();
    return () => viewer.stop();
  }, [viewer]);
  useSyncExternalStore(
    (listener) => viewer.subscribe(listener),
    viewer.getVersion,
    viewer.getVersion
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const raidPlan = toRaidPlan(viewer.doc, `shared-${code}`, { createdAt: 0, updatedAt: 0 });
  const config = getMapConfig(raidPlan.mapKey);
  if (!config) return <p className="p-6 text-sm text-[#888]">This plan&apos;s map is no longer available.</p>;
  return (
    <div className="relative">
      <PlanEditor
        storedPlan={raidPlan}
        config={config}
        session={{ plan: raidPlan, readOnly: true, apply: () => "This is a view link.", undo: () => undefined, redo: () => undefined, canUndo: false, canRedo: false, share: null }}
      />
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-1001 w-[min(28rem,calc(100%-1rem))] -translate-x-1/2">
        <div className={cn(overlayPanel, "pointer-events-auto flex flex-col gap-2 p-3")}>
          <button type="button" onClick={() => setPanelOpen((open) => !open)} className="flex items-center justify-between gap-2 text-left">
            <span className="text-2xs font-bold uppercase tracking-widest text-[#9a8866]">Shared raid plan</span>
            <span className="flex items-center gap-1 text-3xs uppercase tracking-widest text-[#888]">
              <Eye className="h-3 w-3" aria-hidden />
              {viewer.ended ? "Ended" : viewer.live ? `Live · ${viewer.watching} watching` : "Updates every 15 s"}
            </span>
          </button>
          {panelOpen && (
            <>
              {viewer.ended && <p className="text-sm text-red-200">{viewer.ended}</p>}
              {banner}
              {actions}
              {footer}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
