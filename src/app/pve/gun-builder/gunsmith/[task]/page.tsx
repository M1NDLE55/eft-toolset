import { GunsmithPage, gunsmithMetadata, type PageProps } from "@/app/gun-builder/gunsmith/[task]/gunsmith-page";

// The PVE copy of /gun-builder/gunsmith/[task]; see src/app/lib/game-mode-routes.ts.
export const revalidate = 21600;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return gunsmithMetadata(props, "pve");
}

export default function Page(props: PageProps) {
  return <GunsmithPage {...props} gameMode="pve" />;
}
