import { writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import { CONTENT_SCALE_STORE, type ContentScale } from "./content-scale";

export const HOME_LAYOUTS = [
  {
    id: "bento",
    name: "Dashboard",
    description: "A tile per tool showing your recent items, latest build, latest plan and watchlists.",
  },
  {
    id: "search",
    name: "Search first",
    description: "A large item search with your recent items and the four tools underneath.",
  },
  {
    id: "market",
    name: "Market board",
    description: "The biggest flea market movers and the best value per slot, with your watchlists.",
  },
  {
    id: "maps",
    name: "Maps first",
    description: "Every map up front, with your saved plans one click away.",
  },
] as const;

export type HomeLayout = (typeof HOME_LAYOUTS)[number]["id"];

export const DEFAULT_HOME_LAYOUT: HomeLayout = "bento";

export function isHomeLayout(value: unknown): value is HomeLayout {
  return HOME_LAYOUTS.some((layout) => layout.id === value);
}

export const HOME_LAYOUT_STORE: StoreDefinition<HomeLayout> = {
  key: "eft-toolset:settings:home-layout",
  version: 1,
  defaultValue: () => DEFAULT_HOME_LAYOUT,
  validate: isHomeLayout,
};

export function useHomeLayout() {
  return useStore(HOME_LAYOUT_STORE);
}

export function setHomeLayout(layout: HomeLayout) {
  writeStore(HOME_LAYOUT_STORE, layout);
}

export function useContentScale() {
  return useStore(CONTENT_SCALE_STORE);
}

export function setContentScale(scale: ContentScale) {
  writeStore(CONTENT_SCALE_STORE, scale);
}
