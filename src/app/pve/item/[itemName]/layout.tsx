import type { ReactNode } from "react";
import { ItemRouteLayout, type ItemPageProps } from "@/app/item/[itemName]/item-page";

export default function Layout(props: ItemPageProps & { children: ReactNode }) {
  return <ItemRouteLayout {...props} gameMode="pve" />;
}
