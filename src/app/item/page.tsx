import { ItemHub, itemHubMetadata } from "./item-hub";

// Flea market movers: refreshed every five minutes.
export const revalidate = 300;
export const dynamic = "force-static";
export const metadata = itemHubMetadata;

export default function Page() {
  return <ItemHub gameMode="regular" />;
}
