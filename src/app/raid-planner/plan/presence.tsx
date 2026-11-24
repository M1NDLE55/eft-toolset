"use client";

import { Bot, Eye, Wifi, WifiOff } from "lucide-react";
import type { PlanSession, SessionView } from "@/app/lib/account-sync/plan-session";
import type { Presence } from "@/app/lib/durable/live-protocol";
import { overlayPanel } from "@/app/components/raid-planner/ui";
import { cn } from "@/lib/utils";

const PRESENCE_COLORS = ["#78b6d2", "#e2a852", "#9bc878", "#d46b6b", "#c58ad6", "#f0f0f0"];

/** A stable colour per member key, for their chip and the outline around what they're editing. */
export function presenceColor(key: string) {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

/** What others are editing, as outline colours keyed by item ("note:<id>", "wp:<id>"). */
export function highlightsOf(presence: Presence[], myKey: string | null): Map<string, string> {
  const highlights = new Map<string, string>();
  for (const entry of presence) if (entry.editing && entry.key !== myKey) highlights.set(entry.editing, presenceColor(entry.key));
  return highlights;
}

/**
 * Who is here (§11.6): members with their role, "via AI" for agents, and a count of anonymous
 * viewers. Changes only on connect, disconnect and selection, so idle sockets stay quiet.
 */
export function PresenceBar({ view }: { session: PlanSession; view: SessionView }) {
  if (!view.live && view.presence.length === 0) {
    if (view.online) return null;
    return (
      <div className={cn(overlayPanel, "flex items-center gap-2 px-3 py-1.5 text-xs text-[#999]")}>
        <WifiOff className="h-3.5 w-3.5" aria-hidden /> Not live
      </div>
    );
  }
  return (
    <div className={cn(overlayPanel, "flex flex-wrap items-center gap-1.5 px-2 py-1.5 text-xs")} aria-label="Who is here">
      <Wifi className="h-3.5 w-3.5 text-[#9bc878]" aria-hidden />
      {view.presence.map((entry) => (
        <span
          key={`${entry.key}:${entry.via}`}
          className="flex items-center gap-1 border px-1.5 py-0.5 text-[#ddd]"
          style={{ borderColor: presenceColor(entry.key) }}
          title={`${entry.name} · ${entry.role}${entry.via === "mcp" ? ` · via AI${entry.client ? ` (${entry.client})` : ""}` : ""}${entry.editing ? " · editing" : ""}`}
        >
          {entry.via === "mcp" && <Bot className="h-3 w-3" aria-hidden />}
          {entry.name}
          {entry.key === view.myKey && entry.via === "web" ? " (you)" : ""}
          {entry.via === "mcp" && <span className="text-3xs uppercase tracking-widest text-[#888]">via AI</span>}
        </span>
      ))}
      {view.anonymous > 0 && (
        <span className="flex items-center gap-1 text-[#999]" title="People watching through a view link">
          <Eye className="h-3 w-3" aria-hidden /> {view.anonymous}
        </span>
      )}
    </div>
  );
}
