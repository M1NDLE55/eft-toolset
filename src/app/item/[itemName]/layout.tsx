import type { ReactNode } from "react";
import { ItemRouteLayout, type ItemPageProps } from "./item-page";

export default function Layout(props: ItemPageProps & { children: ReactNode }) {
  return <ItemRouteLayout {...props} gameMode="regular" />;
}
