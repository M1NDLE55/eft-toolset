import { QuestPage, questMetadata, type PageProps } from "./quest-page";

// Quests change with patches and wiki edits. Every quest page renders on its first visit.
export const revalidate = 86400;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return questMetadata(props, "regular");
}

export default function Page(props: PageProps) {
  return <QuestPage {...props} gameMode="regular" />;
}
