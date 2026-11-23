import { ItemPage, itemMetadata, type ItemPageProps } from "@/app/item/[itemName]/item-page";

// The PVE copy of /item/[itemName]; see src/app/lib/game-mode-routes.ts.
export const revalidate = 21600;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: ItemPageProps) {
  return itemMetadata(props, "pve");
}

export default function Page(props: ItemPageProps) {
  return <ItemPage {...props} gameMode="pve" />;
}
