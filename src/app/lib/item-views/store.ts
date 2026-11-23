import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useHydrated, useStore } from "@/app/lib/storage/use-store";
import {
  DEFAULT_VIEW_ID,
  MAX_CUSTOM_VIEWS,
  PRESET_VIEWS,
  copyName,
  isItemView,
  isPresetId,
  recoverItemView,
  newViewId,
  presetView,
  type ItemView,
} from "./views";

export interface ItemViewSettings {
  /** A preset's id or a custom view's. */
  active: string;
  custom: ItemView[];
}

function isSettings(value: unknown): value is ItemViewSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<ItemViewSettings>;
  return (
    typeof settings.active === "string" &&
    settings.active.length <= 40 &&
    Array.isArray(settings.custom) &&
    settings.custom.length <= MAX_CUSTOM_VIEWS &&
    settings.custom.every(isItemView) &&
    new Set(settings.custom.map((view) => view.id)).size === settings.custom.length
  );
}

export const ITEM_VIEWS_STORE: StoreDefinition<ItemViewSettings> = {
  key: "eft-toolset:settings:item-views",
  version: 1,
  defaultValue: () => ({ active: DEFAULT_VIEW_ID, custom: [] }),
  validate: isSettings,
  recover: (value) => {
    if (!value || typeof value !== "object") return undefined;
    const { active, custom } = value as Partial<Record<keyof ItemViewSettings, unknown>>;
    const views = Array.isArray(custom) ? custom.flatMap((view) => recoverItemView(view) ?? []) : [];
    const unique = views.filter((view, index) => views.findIndex((other) => other.id === view.id) === index);
    return {
      active: typeof active === "string" && active.length <= 40 ? active : DEFAULT_VIEW_ID,
      custom: unique.slice(0, MAX_CUSTOM_VIEWS),
    };
  },
};

function update(change: (settings: ItemViewSettings) => ItemViewSettings) {
  return writeStore(ITEM_VIEWS_STORE, change(readStore(ITEM_VIEWS_STORE)));
}

export function setActiveView(id: string) {
  update((settings) => ({ ...settings, active: id }));
}

/** Copies a view into a new custom view and makes it the active one; returns its id. */
export function copyView(view: ItemView): string {
  let id = "";
  update((settings) => {
    if (settings.custom.length >= MAX_CUSTOM_VIEWS) {
      throw new Error(`You can keep up to ${MAX_CUSTOM_VIEWS} views. Delete one to make another.`);
    }
    const all = [...PRESET_VIEWS, ...settings.custom];
    id = newViewId(settings.custom);
    const copy: ItemView = { id, name: copyName(view.name, all), cards: view.cards.map((entry) => ({ ...entry })) };
    return { active: id, custom: [...settings.custom, copy] };
  });
  return id;
}

export function updateView(id: string, change: Partial<Omit<ItemView, "id">>) {
  if (isPresetId(id)) throw new Error("Built-in views can't be changed. Copy one to make your own.");
  update((settings) => ({
    ...settings,
    custom: settings.custom.map((view) => (view.id === id ? { ...view, ...change } : view)),
  }));
}

export function deleteView(id: string) {
  update((settings) => ({
    active: settings.active === id ? DEFAULT_VIEW_ID : settings.active,
    custom: settings.custom.filter((view) => view.id !== id),
  }));
}

/**
 * Every view and the active one. Pages are cached for everyone, so until the page hydrates it
 * reports the default view, which the server rendered; then the visitor's own.
 */
export function useItemViews() {
  const settings = useStore(ITEM_VIEWS_STORE);
  const hydrated = useHydrated();
  const views = [...PRESET_VIEWS, ...settings.custom];
  const fallback = presetView(DEFAULT_VIEW_ID)!;
  const stored = views.find((view) => view.id === settings.active) ?? fallback;
  return { views, active: hydrated ? stored : fallback, hydrated };
}
