import { MapKeysPage, mapKeysMetadata, type PageProps } from "./map-keys-page";

// Shows each key's price: refreshed every five minutes. Renders on its first visit.
export const revalidate = 300;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return mapKeysMetadata(props, "regular");
}

export default function Page(props: PageProps) {
  return <MapKeysPage {...props} gameMode="regular" />;
}
