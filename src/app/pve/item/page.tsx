import { ItemHub, itemHubMetadata } from "@/app/item/item-hub";

// The PVE copy of /item; see src/app/lib/game-mode-routes.ts.
export const revalidate = 300;
export const dynamic = "force-static";
export const metadata = itemHubMetadata;

export default function Page() {
  return <ItemHub gameMode="pve" />;
}
