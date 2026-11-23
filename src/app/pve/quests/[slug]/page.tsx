import { QuestPage, questMetadata, type PageProps } from "@/app/quests/[slug]/quest-page";

// The PVE copy of /quests/[slug]; see src/app/lib/game-mode-routes.ts.
export const revalidate = 86400;
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export function generateMetadata(props: PageProps) {
  return questMetadata(props, "pve");
}

export default function Page(props: PageProps) {
  return <QuestPage {...props} gameMode="pve" />;
}
