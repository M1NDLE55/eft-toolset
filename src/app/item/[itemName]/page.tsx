import { ItemPage, itemMetadata, type ItemPageProps } from "./item-page";

// Item details change with patches; prices on the page refresh in the browser, so the cached copy
// can be hours old. Every item page renders on its first visit (see the PR's prebuild notes).
export const revalidate = 21600;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: ItemPageProps) {
  return itemMetadata(props, "regular");
}

export default function Page(props: ItemPageProps) {
  return <ItemPage {...props} gameMode="regular" />;
}
