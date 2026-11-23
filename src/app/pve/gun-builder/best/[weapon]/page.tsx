import { BestBuildsPage, bestBuildsMetadata, type PageProps } from "@/app/gun-builder/best/[weapon]/best-builds-page";

// The PVE copy of /gun-builder/best/[weapon]; see src/app/lib/game-mode-routes.ts.
export const revalidate = 21600;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return bestBuildsMetadata(props, "pve");
}

export default function Page(props: PageProps) {
  return <BestBuildsPage {...props} gameMode="pve" />;
}
