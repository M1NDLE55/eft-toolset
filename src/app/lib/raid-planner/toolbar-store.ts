"use client";

import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";

export type ToolbarSide = "left" | "right";

export interface ToolbarPrefs {
  side: ToolbarSide;
  collapsed: boolean;
}

const DEFAULT_PREFS: ToolbarPrefs = { side: "right", collapsed: false };

function isSide(value: unknown): value is ToolbarSide {
  return value === "left" || value === "right";
}

function isToolbarPrefs(value: unknown): value is ToolbarPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prefs = value as Record<string, unknown>;
  return (
    Object.keys(prefs).length === 2 &&
    isSide(prefs.side) &&
    typeof prefs.collapsed === "boolean"
  );
}

export const TOOLBAR_STORE: StoreDefinition<ToolbarPrefs> = {
  key: "eft-toolset:raid-planner-toolbar",
  version: 1,
  defaultValue: () => ({ ...DEFAULT_PREFS }),
  validate: isToolbarPrefs,
  recover: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prefs = value as Record<string, unknown>;
    return {
      side: isSide(prefs.side) ? prefs.side : DEFAULT_PREFS.side,
      collapsed: typeof prefs.collapsed === "boolean" ? prefs.collapsed : DEFAULT_PREFS.collapsed,
    };
  },
};

export function useToolbarPrefs(): ToolbarPrefs {
  return useStore(TOOLBAR_STORE);
}

export function updateToolbarPrefs(changes: Partial<ToolbarPrefs>) {
  writeStore(TOOLBAR_STORE, { ...readStore(TOOLBAR_STORE), ...changes });
}
