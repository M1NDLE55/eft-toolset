import { AmmoHub, ammoHubMetadata } from "./ammo-hub";

// Shows each round's cheapest price: refreshed every five minutes.
export const revalidate = 300;
export const dynamic = "force-static";
export const metadata = ammoHubMetadata;

export default function Page() {
  return <AmmoHub gameMode="regular" />;
}
