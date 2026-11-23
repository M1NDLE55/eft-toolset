import { AmmoHub, ammoHubMetadata } from "@/app/ammo/ammo-hub";

// The PVE copy of /ammo; see src/app/lib/game-mode-routes.ts.
export const revalidate = 300;
export const dynamic = "force-static";
export const metadata = ammoHubMetadata;

export default function Page() {
  return <AmmoHub gameMode="pve" />;
}
