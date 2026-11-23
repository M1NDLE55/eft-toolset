import { MapKeysPage, mapKeysMetadata, type PageProps } from "@/app/keys/[map]/map-keys-page";

// The PVE copy of /keys/[map]; see src/app/lib/game-mode-routes.ts.
export const revalidate = 300;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return mapKeysMetadata(props, "pve");
}

export default function Page(props: PageProps) {
  return <MapKeysPage {...props} gameMode="pve" />;
}
