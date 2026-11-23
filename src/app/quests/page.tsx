import { QuestsHub, questsHubMetadata } from "./quests-hub";

export const revalidate = 86400;
export const dynamic = "force-static";
export const metadata = questsHubMetadata;

export default function Page() {
  return <QuestsHub gameMode="regular" />;
}
