import { zoneCounterpart } from "@/app/lib/quests/detail-lookup";

export interface SitemapQuest {
  name: string;
  slug: string | null;
}

export interface QuestSitemapEntry {
  path: string;
  /** For the sitemap's lastmod: when the quest's page last changed as far as we know. */
  lastModified: string;
}

/**
 * Every quest page worth indexing: PVP's quests, plus the quests only PVE has. A PVE zone quest's
 * slug redirects to its PVP copy for visitors without a mode, so it is left out; a quest only PVE
 * has renders from PVE data at its own URL, so it is listed.
 *
 * lastModified is the quest's wiki page's last edit as of the snapshot (the guide on the page comes
 * from it), else the snapshot's date: stable between requests, unlike the time of the request.
 */
export function questSitemapEntries(
  pvp: readonly SitemapQuest[],
  pve: readonly SitemapQuest[],
  wikiEdited: ReadonlyMap<string, string>,
  snapshotDate: string
): QuestSitemapEntry[] {
  const listed = new Set(pvp.flatMap((quest) => (quest.slug ? [quest.slug] : [])));
  const pveOnly = pve.filter((quest) => {
    if (!quest.slug || listed.has(quest.slug)) return false;
    const counterpart = zoneCounterpart(quest.slug);
    return counterpart === null || !listed.has(counterpart);
  });
  const seen = new Set<string>();
  return [...pvp, ...pveOnly].flatMap((quest) => {
    if (!quest.slug || seen.has(quest.slug)) return [];
    seen.add(quest.slug);
    return [{ path: `/quests/${quest.slug}`, lastModified: wikiEdited.get(quest.name) ?? snapshotDate }];
  });
}
