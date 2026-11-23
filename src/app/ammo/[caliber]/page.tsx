import { CaliberPage, caliberMetadata, type PageProps } from "./caliber-page";

// Shows each round's cheapest price: refreshed every five minutes. Renders on its first visit.
export const revalidate = 300;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return caliberMetadata(props, "regular");
}

export default function Page(props: PageProps) {
  return <CaliberPage {...props} gameMode="regular" />;
}
