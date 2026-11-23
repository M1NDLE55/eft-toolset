import { GunsmithPage, gunsmithMetadata, type PageProps } from "./gunsmith-page";

// The optimiser runs when the cached page is rendered, at most every six hours, not per request.
export const revalidate = 21600;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return gunsmithMetadata(props, "regular");
}

export default function Page(props: PageProps) {
  return <GunsmithPage {...props} gameMode="regular" />;
}
