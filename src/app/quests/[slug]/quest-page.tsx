import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { ItemImage, ItemLink } from "@/app/components/quests/items-needed-view";
import { ItemRundownQuest } from "@/app/components/item/rundown/rundown-link";
import { Badge, chip, heading, panel, QuestBadges } from "@/app/components/quests/quest-bits";
import { ObjectiveChecklist, QuestCompletePanel, QuestRefLink, QuestTrackingProvider } from "@/app/components/quests/quest-tracker";
import { FaqSection } from "@/app/components/seo/faq-section";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { WikiImageStrip } from "@/app/components/quests/wiki-images";
import { WikiCredit, WikiSections } from "@/app/components/wiki/wiki-text";
import { ServerModeNote } from "@/components/game-mode/server-mode-note";
import { MODE_LABEL, type GameMode } from "@/components/game-mode/mode";
import { readForRender } from "@/app/lib/api/server-render";
import { Rubles } from "@/app/lib/currency";
import { isItemSlug } from "@/app/lib/item-links";
import { ANY_MAP, mapLabels, questName, requirementLabel } from "@/app/lib/quests/display";
import { moneyLabel } from "@/app/lib/quests/shopping-list";
import type { PricedQuestItem, QuestDetail, QuestRef, QuestRewards } from "@/app/lib/quests/types";
import { getKeyCounts } from "@/app/lib/reference/keys";
import { QUEST_HUB_NAME, questDescription, questFaq, questKeyGroups, questSummary, questTitle, rewardPhrases } from "@/app/lib/seo/quests";
import { placeWikiImages } from "@/app/lib/quests/wiki-images";
import { readQuestWiki } from "@/app/lib/wiki/quest-wiki";
import { loadGunsmithTasks } from "@/app/gun-builder/gunsmith/load";
import { loadQuestDetail, loadQuestList } from "../load";

/** The quest page for one game mode: /quests/[slug] renders PVP, and its PVE copy PVE. */
export interface PageProps {
  params: Promise<{ slug: string }>;
}

class QuestUnavailableError extends Error {
  constructor() {
    super("Quest data is temporarily unavailable.");
    this.name = "QuestUnavailableError";
  }
}

const NOT_FOUND: Metadata = { title: "Quest not found", robots: { index: false, follow: false } };
const MAX_CHAIN_SHOWN = 12;

export async function questMetadata({ params }: PageProps, gameMode: GameMode): Promise<Metadata> {
  const slug = (await params).slug;
  if (!isItemSlug(slug)) return NOT_FOUND;
  const loaded = await loadQuestDetail(gameMode, slug);
  if (loaded === null) return NOT_FOUND;
  if (!loaded) return { title: QUEST_HUB_NAME };
  const { detail } = loaded;
  const title = questTitle(detail);
  const description = questDescription(detail);
  const url = `/quests/${detail.quest.slug ?? slug}`;
  // The share image is ./opengraph-image.tsx (and twitter-image.tsx), which Next adds to both.
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title: `${title} | EFT Toolset`, description, url, type: "article" },
    twitter: { card: "summary_large_image", title: `${title} | EFT Toolset`, description },
  };
}

function Section({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className={heading}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Price({ item }: { item: PricedQuestItem | undefined }) {
  if (!item?.buy) return <span className="text-3xs text-[#777]">Loot only</span>;
  return (
    <span className="flex flex-col items-end">
      <span className="tabular-nums text-[#ddd]">{Rubles.format(item.buy.price)}</span>
      <span className="text-3xs text-[#777]">{item.buy.vendor === "Flea Market" ? "Flea" : item.buy.vendor}</span>
    </span>
  );
}

function ItemRow({ item, count, badge }: { item: PricedQuestItem | undefined; count?: number; badge?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 hover:bg-[#100f0c]">
      <ItemImage item={item} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
        <ItemLink item={item} />
        {badge}
      </span>
      {count !== undefined && <span className="shrink-0 font-semibold tabular-nums text-[#e6d9b8]">×{count.toLocaleString("en-US")}</span>}
      <span className="w-24 shrink-0 text-right text-sm">
        <Price item={item} />
      </span>
    </li>
  );
}

function ItemsNeeded({ detail }: { detail: QuestDetail }) {
  return (
    <ul className={`${panel} divide-y divide-[#151515]`}>
      {detail.quest.needs.map((need) => {
        const key = need.objectives.join("-");
        const fir = need.foundInRaid ? <Badge>FIR</Badge> : null;
        if (need.items.length === 1 && need.alternatives === undefined) {
          const id = need.items[0];
          const money = moneyLabel(id, need.count);
          if (money) {
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2">
                <ItemImage item={detail.items[id]} />
                <span className="flex-1 text-sm text-[#ccc]">Hand over money</span>
                <span className="font-semibold tabular-nums text-[#e6d9b8]">{money}</span>
              </li>
            );
          }
          return <ItemRow key={key} item={detail.items[id]} count={need.count} badge={fir} />;
        }
        const shown = need.items.slice(0, 12);
        const more = Math.max(need.alternatives ?? 0, need.items.length) - shown.length;
        return (
          <li key={key} className="flex flex-col gap-1 px-3 py-2">
            <span className="flex flex-wrap items-center gap-2 text-sm text-[#ccc]">
              <span className="font-semibold tabular-nums text-[#e6d9b8]">×{need.count}</span>
              {fir}
              {need.label ?? "Any one of these"}
            </span>
            {shown.length > 0 && (
              <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[#888]">
                Any of:
                {shown.map((id) => (
                  <ItemLink key={id} item={detail.items[id]} className="text-[#aaa] underline-offset-2 hover:text-[#e6d9b8] hover:underline" />
                ))}
                {more > 0 && <span>and {more} more</span>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Rewards({ detail, rewards, withExperience }: { detail: QuestDetail; rewards: QuestRewards; withExperience: boolean }) {
  const items = rewards.items.filter((entry) => !moneyLabel(entry.id, entry.count));
  const other = rewardPhrases(detail, { ...rewards, items: rewards.items.filter((entry) => moneyLabel(entry.id, entry.count)) }, withExperience);
  return (
    <div className="flex flex-col gap-2">
      {other.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {other.map((phrase) => (
            <li key={phrase} className="border border-[#2a2a2a] bg-[#0c0c0c] px-2.5 py-1.5 text-xs text-[#ccc]">
              {phrase}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul className={`${panel} divide-y divide-[#151515]`}>
          {items.map((entry) => (
            <ItemRow key={entry.id} item={detail.items[entry.id]} count={entry.count} />
          ))}
        </ul>
      )}
    </div>
  );
}

function hasRewards(rewards: QuestRewards) {
  return Object.values(rewards).some((entries) => entries.length > 0);
}

function ChainList({ ids, quests, label }: { ids: string[]; quests: Record<string, QuestRef>; label: string }) {
  const refs = ids.map((id) => quests[id]).filter((quest): quest is QuestRef => Boolean(quest));
  const links = (entries: QuestRef[]) =>
    entries.map((quest) => (
      <li key={quest.id}>
        {quest.slug ? (
          <Link href={`/quests/${quest.slug}`} className={chip}>
            {quest.name}
          </Link>
        ) : (
          <span className={chip}>{quest.name}</span>
        )}
      </li>
    ));
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-3xs font-bold uppercase tracking-widest text-[#777]">
        {label} · {refs.length}
      </h3>
      <ol className="flex flex-wrap gap-1.5">{links(refs.slice(0, MAX_CHAIN_SHOWN))}</ol>
      {refs.length > MAX_CHAIN_SHOWN && (
        <details>
          <summary className="cursor-pointer text-2xs font-bold uppercase tracking-widest text-[#c8b384]">
            {refs.length - MAX_CHAIN_SHOWN} more
          </summary>
          <ol className="mt-1.5 flex flex-wrap gap-1.5">{links(refs.slice(MAX_CHAIN_SHOWN))}</ol>
        </details>
      )}
    </div>
  );
}

export async function QuestPage({ params, gameMode }: PageProps & { gameMode: GameMode }) {
  const slug = (await params).slug;
  if (!isItemSlug(slug)) notFound();
  const loaded = await loadQuestDetail(gameMode, slug);
  if (loaded === null) notFound();
  // Fail the render rather than cache a page without its quest.
  if (loaded === undefined) throw new QuestUnavailableError();
  const { detail } = loaded;
  const { quest } = detail;
  // Only a zone quest's copy for the other mode has another slug: a temporary redirect, from this
  // mode's copy of the page only.
  if (quest.slug && quest.slug !== slug) redirect(`/quests/${quest.slug}`);

  const builds = detail.objectives.some((objective) => objective.type === "buildWeapon");
  const [wiki, keyMaps, questList, gunsmith] = await Promise.all([
    readQuestWiki({ wikiLink: detail.wikiLink, name: quest.name }),
    readForRender("Keys list", () => getKeyCounts("regular")),
    loadQuestList(gameMode),
    builds ? loadGunsmithTasks() : undefined,
  ]);
  const buildPage = quest.slug && gunsmith?.some((task) => task.slug === quest.slug) ? `/gun-builder/gunsmith/${quest.slug}` : null;
  const withKeys = new Set((keyMaps ?? []).map((map) => map.key));
  const name = questName(quest);
  const faq = questFaq(detail);
  const self: QuestRef = { ...detail.quests[quest.id], name };
  const otherMode = detail.gameMode !== gameMode;
  const anyMap = mapLabels(quest.maps, detail.maps)[0] === ANY_MAP;
  // A quest for any map would link every map: the header and objectives say "any map" instead.
  const pages = anyMap
    ? []
    : Array.from(
        new Map(
          quest.maps.flatMap((key) => {
            const map = detail.maps[key];
            return map?.page ? [[map.page, detail.maps[map.page]?.name ?? map.name] as const] : [];
          })
        )
      );
  const keys = questKeyGroups(detail);
  const summary = questSummary(detail, { buildPage: buildPage !== null });
  const objectives = detail.objectives;
  const images = wiki ? placeWikiImages(wiki.images, objectives, detail.maps) : null;
  const traderQuests =
    questList && questList.gameMode === detail.gameMode ? questList.list.quests.filter((entry) => entry.trader === quest.trader && entry.slug) : [];
  const index = traderQuests.findIndex((entry) => entry.id === quest.id);
  const neighbours = index >= 0 ? [traderQuests[index - 1], traderQuests[index + 1]].filter((entry) => entry !== undefined) : [];
  const meta = [
    quest.trader,
    quest.minPlayerLevel > 1 ? `level ${quest.minPlayerLevel}` : null,
    quest.faction ? `${quest.faction} only` : null,
    anyMap ? "any map" : null,
    ...quest.traderLevels.map((entry) => `${entry.trader} LL${entry.level}`),
    quest.experience > 0 ? `${quest.experience.toLocaleString("en-US")} XP` : null,
    detail.restartable ? "restartable" : null,
  ].filter(Boolean);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: QUEST_HUB_NAME, path: "/quests" },
          { name, path: `/quests/${quest.slug ?? slug}` },
        ])}
      />
      {faq.length > 0 && <JsonLd data={faqPage(faq)} />}
      <nav aria-label="Breadcrumb" className="-mb-4 text-2xs uppercase tracking-widest text-[#777]">
        <Link href="/quests" className="hover:text-[#c8b384] hover:underline underline-offset-2">
          {QUEST_HUB_NAME}
        </Link>
        {quest.trader && (
          <>
            {" / "}
            <Link
              href={`/quests?view=chains&trader=${encodeURIComponent(quest.trader)}`}
              className="hover:text-[#c8b384] hover:underline underline-offset-2"
            >
              {quest.trader}
            </Link>
          </>
        )}
      </nav>
      <header className="flex items-center gap-4">
        {quest.image && (
          <span className="hidden h-16 w-28 shrink-0 items-center justify-center overflow-hidden bg-[#0c0c0c] sm:flex">
            <Image src={quest.image} alt="" width={112} height={64} className="h-16 w-auto object-cover" />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">{name}</h1>
          <p className="text-sm text-[#888]">
            {meta.join(" · ")}
            {detail.wikiLink && (
              <>
                {" · "}
                <a href={detail.wikiLink} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-0.5 text-[#c8b384] underline-offset-2 hover:underline">
                  Wiki <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <QuestBadges quest={quest} />
          </div>
        </div>
      </header>
      <p className="text-sm text-[#999]">
        {otherMode && (
          <strong className="font-semibold text-amber-200">
            Only in {MODE_LABEL[detail.gameMode]}: this quest isn&apos;t in {MODE_LABEL[gameMode]}, so this page shows {MODE_LABEL[detail.gameMode]} data.{" "}
          </strong>
        )}
        Objectives, items and rewards come from tarkov.dev; tick objectives off as you go. <ServerModeNote rendered={gameMode} prices={detail.gameMode} />
      </p>
      {pages.length > 0 && (
        <nav aria-label="Maps" className="-mt-4 flex flex-wrap gap-1.5">
          {pages.map(([page, mapName]) => (
            <span key={page} className="contents">
              <Link href={`/raid-planner/map/${page}`} className={chip}>
                {mapName} map
              </Link>
              {withKeys.has(page) && (
                <Link href={`/keys/${page}`} className={chip}>
                  {mapName} keys
                </Link>
              )}
            </span>
          ))}
        </nav>
      )}

      <Section id="summary" title="Quest summary">
        <div className={`${panel} flex flex-col gap-2 p-4 text-sm leading-relaxed text-[#ccc]`}>
          {summary.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Section>

      <ItemRundownQuest quest={{ name: quest.name, trader: quest.trader, faction: quest.faction }}>
        <QuestTrackingProvider gameMode={detail.gameMode}>
          <QuestCompletePanel quest={self} names={detail.quests} />

          <Section
            id="objectives"
            title="Objectives"
            aside={
              buildPage && (
                <Link href={buildPage} className="text-2xs font-bold uppercase tracking-widest text-[#c8b384] underline-offset-2 hover:underline">
                  Ready build for this quest
                </Link>
              )
            }
          >
            {objectives.length > 0 ? (
              <ObjectiveChecklist objectives={objectives} items={detail.items} maps={detail.maps} images={images?.objectives} />
            ) : (
              <p className="border border-dashed border-[#2a2a2a] p-4 text-sm text-[#888]">tarkov.dev lists no objectives for this quest.</p>
            )}
            {images && <WikiImageStrip groups={images.strip} />}
          </Section>

          {quest.needs.length > 0 && (
            <Section id="items" title="Items to hand over" aside={<span className="text-3xs uppercase tracking-widest text-[#666]">Buy price</span>}>
              <ItemsNeeded detail={detail} />
            </Section>
          )}

          {keys.length > 0 && (
            <Section id="keys" title="Keys">
              <div className="flex flex-col gap-2">
                {keys.map((group) => (
                  <div key={group.map ?? "any"} className="flex flex-col gap-1">
                    {group.map && detail.maps[group.map] && (
                      <span className="text-3xs font-bold uppercase tracking-widest text-[#777]">{detail.maps[group.map].name}</span>
                    )}
                    <ul className={`${panel} divide-y divide-[#151515]`}>
                      {group.ids.map((id) => (
                        <ItemRow key={id} item={detail.items[id]} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section id="rewards" title="Rewards">
            {hasRewards(detail.rewards) || quest.experience > 0 ? (
              <Rewards detail={detail} rewards={detail.rewards} withExperience />
            ) : (
              <p className="text-sm text-[#888]">No rewards listed.</p>
            )}
            {hasRewards(detail.startRewards) && (
              <div className="mt-2 flex flex-col gap-2">
                <h3 className="text-3xs font-bold uppercase tracking-widest text-[#777]">On accepting</h3>
                <Rewards detail={detail} rewards={detail.startRewards} withExperience={false} />
              </div>
            )}
          </Section>

          <Section id="requirements" title="Before and after">
            <div className={`${panel} grid grid-cols-1 gap-4 p-3 sm:grid-cols-2`}>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-3xs font-bold uppercase tracking-widest text-[#777]">Needs</h3>
                {detail.prerequisites.length === 0 && quest.minPlayerLevel <= 1 ? (
                  <p className="text-sm text-[#888]">Nothing: it&apos;s open from the start.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {quest.minPlayerLevel > 1 && <li className="text-sm text-[#ccc]">Level {quest.minPlayerLevel}</li>}
                    {quest.traderLevels.map((entry) => (
                      <li key={entry.trader} className="text-sm text-[#ccc]">
                        {entry.trader} loyalty level {entry.level}
                      </li>
                    ))}
                    {detail.prerequisites.map((requirement) =>
                      detail.quests[requirement.id] ? (
                        <li key={requirement.id}>
                          <QuestRefLink quest={detail.quests[requirement.id]} note={requirementLabel(requirement.status)} />
                        </li>
                      ) : null
                    )}
                  </ul>
                )}
                {quest.failedBy.length > 0 && (
                  <>
                    <h3 className="mt-2 text-3xs font-bold uppercase tracking-widest text-red-300/80">Fails if you complete</h3>
                    <ul className="flex flex-col gap-1.5">
                      {quest.failedBy.map((entry) =>
                        detail.quests[entry.id] ? (
                          <li key={entry.id}>
                            <QuestRefLink quest={detail.quests[entry.id]} />
                          </li>
                        ) : null
                      )}
                    </ul>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-3xs font-bold uppercase tracking-widest text-[#777]">Leads to</h3>
                {detail.unlocks.length === 0 ? (
                  <p className="text-sm text-[#888]">No quest needs this one.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {detail.unlocks.map((entry) =>
                      detail.quests[entry.id] ? (
                        <li key={entry.id}>
                          <QuestRefLink
                            quest={detail.quests[entry.id]}
                            note={entry.status.length === 1 && entry.status[0] === "failed" ? "if this one fails" : entry.status.includes("complete") ? undefined : "once started"}
                          />
                        </li>
                      ) : null
                    )}
                  </ul>
                )}
              </div>
            </div>
            {(detail.chain.before.length > detail.prerequisites.length || detail.chain.after.length > detail.unlocks.length) && (
              <div className="mt-2 flex flex-col gap-3">
                {detail.chain.before.length > 0 && <ChainList ids={detail.chain.before} quests={detail.quests} label="Whole chain before, in order" />}
                {detail.chain.after.length > 0 && <ChainList ids={detail.chain.after} quests={detail.quests} label="Everything it leads to" />}
              </div>
            )}
          </Section>
        </QuestTrackingProvider>
      </ItemRundownQuest>

      {wiki && wiki.guide.length > 0 ? (
        <Section id="guide" title="Wiki guide">
          <div className={`${panel} p-4`}>
            <WikiSections sections={wiki.guide} />
            <WikiCredit wiki={wiki} />
          </div>
        </Section>
      ) : (
        <Section id="guide" title="Wiki guide">
          <p className="border border-dashed border-[#2a2a2a] p-4 text-sm text-[#888]">
            {wiki ? "The wiki has no guide for this quest yet." : "The wiki has no page for this quest; it may have been removed from the game."}
            {detail.wikiLink && (
              <>
                {" "}
                <a href={detail.wikiLink} target="_blank" rel="noopener noreferrer" className="text-[#c8b384] underline underline-offset-2">
                  Check the wiki
                </a>
                .
              </>
            )}
          </p>
        </Section>
      )}
      {wiki && wiki.dialogue.length > 0 && (
        <details className={`${panel} p-4`}>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-[#9a8866]">Dialogue</summary>
          <div className="mt-3">
            <WikiSections sections={wiki.dialogue} />
            <WikiCredit wiki={wiki} />
          </div>
        </details>
      )}

      {faq.length > 0 && <FaqSection id="quest-faq" title={`${name} questions`} entries={faq} />}

      <nav aria-label="More quests" className="flex flex-col gap-2">
        <h2 className={heading}>More quests</h2>
        <ul className="flex flex-wrap gap-2">
          {neighbours.map((entry) => (
            <li key={entry.id}>
              <Link href={`/quests/${entry.slug}`} className={chip}>
                {questName(entry)}
              </Link>
            </li>
          ))}
          {quest.trader && (
            <li>
              <Link href={`/quests?view=chains&trader=${encodeURIComponent(quest.trader)}`} className={chip}>
                {quest.trader}&apos;s quest chain
              </Link>
            </li>
          )}
          <li>
            <Link href="/quests" className={chip}>
              All quests
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
