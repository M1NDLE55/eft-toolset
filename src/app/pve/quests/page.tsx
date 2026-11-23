import { QuestsHub, questsHubMetadata } from "@/app/quests/quests-hub";

// The PVE copy of /quests; see src/app/lib/game-mode-routes.ts.
export const revalidate = 86400;
export const dynamic = "force-static";
export const metadata = questsHubMetadata;

export default function Page() {
  return <QuestsHub gameMode="pve" />;
}
