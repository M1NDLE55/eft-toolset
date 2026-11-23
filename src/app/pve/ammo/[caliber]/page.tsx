import { CaliberPage, caliberMetadata, type PageProps } from "@/app/ammo/[caliber]/caliber-page";

// The PVE copy of /ammo/[caliber]; see src/app/lib/game-mode-routes.ts.
export const revalidate = 300;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return caliberMetadata(props, "pve");
}

export default function Page(props: PageProps) {
  return <CaliberPage {...props} gameMode="pve" />;
}
