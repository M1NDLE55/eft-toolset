import { ANY_MAP, mapLabels, questName, questTitleName, requirementLabel } from "@/app/lib/quests/display";
import { moneyLabel } from "@/app/lib/quests/shopping-list";
import type { QuestDetail, QuestItemNeed, QuestList, QuestRewards } from "@/app/lib/quests/types";
import type { FaqEntry } from "./item";
import { formatRoubles, plural } from "./format";

export const QUEST_HUB_NAME = "Quests";
export const QUEST_HUB_TITLE = "Tarkov Quest Tracker: Every Quest, Items Needed & Chains";
export const QUEST_HUB_DESCRIPTION =
  "Every Escape from Tarkov quest by trader, map and level, with what's available to you now, every item to keep (found in raid marked), each trader's quest chain, and progress saved in your browser for PVP and PVE.";

const MAX_DESCRIPTION = 160;
const MAX_LISTED = 4;

// Google shows about 60 characters of a title.
const MAX_TITLE = 60;
const TITLE_GUIDE = " – Tarkov Quest Guide";

/**
 * "Delivery From the Past – Tarkov Quest Guide: Keys & Rewards": the name players search with
 * "Tarkov", and what the page covers, as much of it as fits in about 60 characters. Rendered
 * without the site name, which would push the quest out of view.
 */
export function questTitle(detail: Pick<QuestDetail, "quest">) {
  const { quest } = detail;
  const name = questTitleName(quest);
  const covers = quest.keys.length > 0 ? "Keys" : quest.needs.length > 0 ? "Items" : null;
  const tails = [
    `${TITLE_GUIDE}: ${covers ? `Objectives, ${covers}` : "Objectives"} & Rewards`,
    `${TITLE_GUIDE}: ${covers ?? "Objectives"} & Rewards`,
    `${TITLE_GUIDE} & Rewards`,
    TITLE_GUIDE,
  ];
  const tail = tails.find((candidate) => name.length + candidate.length <= MAX_TITLE) ?? " – Tarkov Quest";
  return name + tail;
}

function listed(names: string[], max = MAX_LISTED) {
  // "and 1 more" is no shorter than naming it.
  if (names.length <= max + 1) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function needText(detail: QuestDetail, need: QuestItemNeed) {
  const fir = need.foundInRaid ? " (found in raid)" : "";
  if (need.items.length === 1 && need.alternatives === undefined) {
    const id = need.items[0];
    return moneyLabel(id, need.count) ?? `${need.count}× ${detail.items[id]?.name ?? "item"}${fir}`;
  }
  // Variants of an item can share a name (dogtags of each level): name each once.
  const names = Array.from(new Set(need.items.map((id) => detail.items[id]?.name).filter((name): name is string => Boolean(name))));
  if (names.length === 1 && (need.alternatives ?? 0) <= need.items.length) return `${need.count}× ${names[0]}${fir}`;
  return names.length > 0 ? `${need.count}× any of ${listed(names, 3)}${fir}` : (need.label ?? `${need.count} qualifying items${fir}`);
}

/** Rewards as phrases: experience first, then money and items, standing and unlocks. */
export function rewardPhrases(detail: Pick<QuestDetail, "items" | "quest">, rewards: QuestRewards, withExperience = true) {
  const phrases: string[] = [];
  if (withExperience && detail.quest.experience > 0) phrases.push(`${detail.quest.experience.toLocaleString("en-US")} XP`);
  for (const item of rewards.items) {
    phrases.push(moneyLabel(item.id, item.count) ?? `${item.count > 1 ? `${item.count}× ` : ""}${detail.items[item.id]?.name ?? "an item"}`);
  }
  for (const entry of rewards.traderStanding) {
    phrases.push(`${entry.standing > 0 ? "+" : ""}${entry.standing.toFixed(2)} ${entry.trader} standing`);
  }
  for (const offer of rewards.offerUnlocks) {
    phrases.push(`unlocks ${detail.items[offer.id]?.name ?? "an item"} at ${offer.trader}${offer.level ? ` LL${offer.level}` : ""}`);
  }
  for (const craft of rewards.craftUnlocks) {
    phrases.push(`unlocks a ${detail.items[craft.id]?.name ?? "item"} craft (${craft.station}${craft.level ? ` level ${craft.level}` : ""})`);
  }
  for (const trader of rewards.traderUnlocks) phrases.push(`unlocks ${trader}`);
  for (const skill of rewards.skills) phrases.push(`${skill.name} level ${skill.level}`);
  return phrases;
}

/** The quest's keys by map: tarkov.dev's needed keys, then keys objectives name that it leaves out. */
export function questKeyGroups(detail: Pick<QuestDetail, "quest" | "objectives">) {
  const byMap = new Map<string | null, Set<string>>();
  const add = (map: string | null, id: string) => byMap.set(map, (byMap.get(map) ?? new Set()).add(id));
  for (const entry of detail.quest.keys) for (const id of entry.keys) add(entry.map, id);
  const listed = new Set(detail.quest.keys.flatMap((entry) => entry.keys));
  for (const objective of detail.objectives) {
    for (const id of objective.requiredKeys.flat()) if (!listed.has(id)) add(objective.maps[0] ?? null, id);
  }
  return Array.from(byMap, ([map, ids]) => ({ map, ids: Array.from(ids) }));
}

function keyNames(detail: QuestDetail) {
  const ids = new Set(questKeyGroups(detail).flatMap((group) => group.ids));
  return Array.from(ids, (id) => detail.items[id]?.name).filter((name): name is string => Boolean(name));
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** "on Customs and Factory", "on any map", or null for a quest with no map. */
function mapPhrase(detail: Pick<QuestDetail, "quest" | "maps">, max = 3) {
  const labels = mapLabels(detail.quest.maps, detail.maps);
  if (labels.length === 0) return null;
  return labels[0] === ANY_MAP ? "on any map" : `on ${listed(labels, max)}`;
}

/** Items found in raid the quest takes, counted one by one. */
function firCount(detail: QuestDetail) {
  return detail.quest.needs.reduce((total, need) => total + (need.foundInRaid && !isMoney(detail, need) ? need.count : 0), 0);
}

function isMoney(detail: QuestDetail, need: QuestItemNeed) {
  return need.items.length === 1 && need.alternatives === undefined && moneyLabel(need.items[0], need.count) !== null;
}

/**
 * The rewards most worth naming: what it unlocks (a trader, else an offer, else a craft), and the
 * money and most valuable item it pays.
 */
export function mainRewards(detail: Pick<QuestDetail, "items" | "rewards">): { unlock: string | null; goods: string[] } {
  const { rewards } = detail;
  // tarkov.dev names a weapon's default preset "… Default".
  const name = (id: string) => detail.items[id].name.replace(/ Default$/, "");
  const offer = rewards.offerUnlocks.find((entry) => detail.items[entry.id]);
  const craft = rewards.craftUnlocks.find((entry) => detail.items[entry.id]);
  const unlock =
    rewards.traderUnlocks.length > 0
      ? listed(rewards.traderUnlocks)
      : offer
        ? `${name(offer.id)} at ${offer.trader}${offer.level ? ` LL${offer.level}` : ""}`
        : craft
          ? `the ${name(craft.id)} craft`
          : null;
  const value = (entry: { id: string; count: number }) => (detail.items[entry.id].buy?.price ?? detail.items[entry.id].sell?.price ?? 0) * entry.count;
  const best = rewards.items
    .filter((entry) => !moneyLabel(entry.id, entry.count) && detail.items[entry.id] && (!offer || name(entry.id) !== name(offer.id))).toSorted((a, b) => value(b) - value(a))[0];
  const money = rewards.items.find((entry) => moneyLabel(entry.id, entry.count));
  const goods = [
    money ? moneyLabel(money.id, money.count)! : null,
    best ? `${best.count > 1 ? `${best.count}× ` : ""}${name(best.id)}` : null,
  ].filter((entry): entry is string => entry !== null);
  return { unlock, goods };
}

/**
 * The quest's needs as phrases, a single item's needs merged into one ("3× Gas analyzer (2 found in
 * raid)"), so an item handed over twice reads once.
 */
function needPhrases(detail: QuestDetail) {
  const merged = new Map<string, { count: number; fir: number }>();
  const phrases: (string | { id: string })[] = [];
  for (const need of detail.quest.needs) {
    const single = need.items.length === 1 && need.alternatives === undefined && !isMoney(detail, need);
    if (!single) {
      phrases.push(needText(detail, need));
      continue;
    }
    const id = need.items[0];
    const entry = merged.get(id);
    if (!entry) phrases.push({ id });
    merged.set(id, { count: (entry?.count ?? 0) + need.count, fir: (entry?.fir ?? 0) + (need.foundInRaid ? need.count : 0) });
  }
  return phrases.map((phrase) => {
    if (typeof phrase === "string") return phrase;
    const { count, fir } = merged.get(phrase.id)!;
    const name = detail.items[phrase.id]?.name ?? "item";
    return `${count}× ${name}${fir === 0 ? "" : fir === count ? " (found in raid)" : ` (${fir} found in raid)`}`;
  });
}

/** What the quest does with the items it takes: hands them over, plants them, or a mix of the two and more. */
function needVerb(detail: QuestDetail) {
  const types = new Set(
    detail.quest.needs.flatMap((need) => need.objectives.map((id) => detail.objectives.find((objective) => objective.id === id)?.type ?? null))
  );
  if (Array.from(types).every((type) => type === "giveItem" || type === "findItem" || type === null)) return "Hand over";
  if (Array.from(types).every((type) => type === "plantItem" || type === "mark")) return "Plant";
  return "Bring";
}

/** Names of the single items the quest takes, each once. */
function singleItemNames(detail: QuestDetail) {
  const names = detail.quest.needs.flatMap((need) =>
    need.items.length === 1 && need.alternatives === undefined && !isMoney(detail, need) && detail.items[need.items[0]] ? [detail.items[need.items[0]].name] : []
  );
  return Array.from(new Set(names));
}

/** Objective text to quote: the ones that aren't handing over or finding items, which the needs already say. */
function objectiveTexts(detail: QuestDetail) {
  const required = detail.objectives.filter((objective) => !objective.optional && objective.description.trim());
  const tasks = required.filter((objective) => objective.type !== "giveItem" && objective.type !== "findItem");
  return (tasks.length > 0 || detail.quest.needs.length > 0 ? tasks : required).map((objective) => objective.description.trim().replace(/[.\s]+$/, ""));
}

/** Takes clauses in priority order, each in its longest wording that still fits, and joins them in reading order. */
function fit(clauses: { order: number; variants: (string | null)[] }[], max: number) {
  const chosen: [number, string][] = [];
  let length = -1;
  for (const clause of clauses) {
    const text = clause.variants.find((variant): variant is string => variant !== null && length + 1 + variant.length <= max);
    if (!text) continue;
    chosen.push([clause.order, text]);
    length += 1 + text.length;
  }
  return chosen
    .toSorted(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join(" ");
}

/**
 * About 150–160 characters for search results: who gives the quest and where, the keys and
 * found-in-raid items to bring, the main reward and what it leads to, in that order; the less
 * useful clauses shorten or drop out first when it runs long.
 */
export function questDescription(detail: QuestDetail) {
  const { quest } = detail;
  const name = questName(quest);
  const level = quest.minPlayerLevel > 1 ? `level ${quest.minPlayerLevel} ` : "";
  const faction = quest.faction ? ` for ${quest.faction}` : "";
  const maps = mapPhrase(detail);
  const giver = quest.trader ? `${possessive(quest.trader)} ${level}quest${faction}` : `a ${level}quest${faction}`;
  const who = [
    `${name} is ${giver}${maps ? ` ${maps}` : ""}.`,
    maps ? `${name} is ${giver} ${mapPhrase(detail, 1)}.` : null,
    `${name} is ${giver}.`,
    `${name}: ${quest.trader ?? "Tarkov"} quest.`,
  ];

  const keys = keyNames(detail);
  const keyClause = [
    keys.length > 0 ? `Bring the ${listed(keys, 2)}${keys.length > 2 ? " keys" : ""}.` : null,
    keys.length > 1 ? `Bring ${keys.length} keys.` : null,
    keys.length === 1 ? "Bring a key." : null,
  ];

  const fir = firCount(detail);
  const verb = needVerb(detail);
  const needs = needPhrases(detail);
  const including = singleItemNames(detail);
  const items = quest.needs.reduce((total, need) => total + (isMoney(detail, need) ? 0 : need.count), 0);
  const itemClause = [
    needs.length > 0 && needs.length <= 2 ? `${verb} ${listed(needs)}.` : null,
    needs.length > 2 && including.length >= 2 ? `${verb} ${plural(items, "item")}${fir > 0 ? (fir === items ? ", all found in raid" : `, ${fir} found in raid`) : ""}, including ${listed(including.slice(0, 2))}.` : null,
    items > 0 && fir === items ? `${verb} ${plural(items, "found-in-raid item")}.` : null,
    items > 0 ? `${verb} ${plural(items, "item")}${fir > 0 ? `, ${fir} found in raid` : ""}.` : null,
    fir > 0 ? `${fir} found-in-raid ${fir === 1 ? "item" : "items"} needed.` : null,
  ];

  const tasks = objectiveTexts(detail);
  const taskClause = tasks.length > 0 ? [`${tasks.length > 1 ? "Objectives" : "Objective"}: ${tasks.join("; ")}.`, ...tasks.slice(0, -1).map((_, index) => `Objectives: ${tasks.slice(0, tasks.length - 1 - index).join("; ")}; and more.`)] : [];
  if (tasks.length > 1) taskClause.push(`First objective: ${tasks[0]}.`);

  const { unlock, goods } = mainRewards(detail);
  const xp = quest.experience > 0 ? `${quest.experience.toLocaleString("en-US")} XP` : null;
  const paid = [xp, ...goods].filter((entry): entry is string => entry !== null);
  const rewardClause = [
    paid.length > 0 && unlock ? `Rewards: ${listed(paid)}; unlocks ${unlock}.` : null,
    unlock ? `Unlocks ${unlock}.` : null,
    paid.length > 0 ? `Rewards: ${listed(paid)}.` : null,
    xp ? `Rewards: ${xp}.` : null,
  ];

  const next = detail.unlocks.map((entry) => detail.quests[entry.id]?.name).filter((entry): entry is string => Boolean(entry));
  const nextClause = [next.length > 0 ? `Leads to ${listed(next, 2)}.` : null, next.length > 1 ? `Leads to ${plural(next.length, "quest")}.` : null];
  const kappa = quest.kappaRequired ? (quest.lightkeeperRequired ? "Needed for Kappa and Lightkeeper." : "Needed for Kappa.") : quest.lightkeeperRequired ? "Needed for Lightkeeper." : null;

  return fit(
    [
      { order: 0, variants: who },
      { order: 2, variants: keyClause },
      { order: 3, variants: itemClause },
      { order: 4, variants: rewardClause },
      { order: 1, variants: taskClause },
      { order: 5, variants: nextClause },
      { order: 6, variants: [kappa] },
      { order: 7, variants: ["See every objective and reward."] },
    ],
    MAX_DESCRIPTION
  );
}

/** The cheapest buy price for every item the quest takes that needn't be found in raid; null when any can't be bought. */
function buyCost(detail: QuestDetail) {
  let total = 0;
  let any = false;
  for (const need of detail.quest.needs) {
    if (need.foundInRaid || need.items.length !== 1 || need.alternatives !== undefined || isMoney(detail, need)) continue;
    const price = detail.items[need.items[0]]?.buy?.price;
    if (!price) return null;
    total += price * need.count;
    any = true;
  }
  return any ? total : null;
}

/** Two significant figures: prices move daily, so "about 21,000 ₽" says enough. */
export function roughly(value: number) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, value))) - 1);
  return Math.round(value / step) * step;
}

function joinRequirements(detail: QuestDetail) {
  const named = detail.prerequisites.filter((requirement) => detail.quests[requirement.id]);
  if (named.length > 3) return [`finish ${named.length} other quests (listed below)`];
  const byLabel = new Map<string, string[]>();
  for (const requirement of detail.prerequisites) {
    const name = detail.quests[requirement.id]?.name;
    if (!name) continue;
    const label = requirementLabel(requirement.status);
    byLabel.set(label, [...(byLabel.get(label) ?? []), name]);
  }
  return Array.from(byLabel, ([label, names]) => `${label} ${listed(names, 3)}`);
}

/**
 * A short brief for the top of the quest page, written from tarkov.dev's data: who gives it and
 * when, where it goes, what to bring, a couple of practical notes the data supports, and what it
 * leads to. Each entry is a paragraph.
 */
export function questSummary(detail: QuestDetail, options: { buildPage?: boolean } = {}): string[] {
  const { quest } = detail;
  const name = questName(quest);
  const paragraphs: string[] = [];

  const opens: string[] = [];
  const after = joinRequirements(detail);
  if (quest.minPlayerLevel > 1) opens.push(`from level ${quest.minPlayerLevel}`);
  if (after.length > 0) opens.push(`once you ${listed(after)}`);
  const byLevel = new Map<number, string[]>();
  for (const entry of quest.traderLevels) byLevel.set(entry.level, [...(byLevel.get(entry.level) ?? []), entry.trader]);
  for (const [level, traders] of byLevel) opens.push(`with loyalty level ${level} at ${traders.length > 3 ? `${traders.length} traders` : listed(traders)}`);
  const giver = quest.trader ? `${quest.trader} gives ${name}` : `${name} is given`;
  const intro = `${giver}${quest.faction ? ` to ${quest.faction} players` : ""}${opens.length > 0 ? ` ${listed(opens)}` : " from the start, with nothing to do first"}.`;
  const labels = mapLabels(quest.maps, detail.maps);
  // When no objective needs one map in particular, any of the maps will do.
  const either = !detail.objectives.some((objective) => mapLabels(objective.maps, detail.maps).length === 1);
  const where =
    labels.length === 0
      ? "None of its objectives is tied to a map."
      : labels[0] === ANY_MAP
        ? "You can do it on any map."
        : either && labels.length > 1
          ? `You can do it on ${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}.`
          : `The objectives take you to ${listed(labels, 6)}.`;
  paragraphs.push(`${intro} ${where}`);

  const bring: string[] = [];
  const groups = questKeyGroups(detail);
  const keyIds = Array.from(new Set(groups.flatMap((group) => group.ids)));
  if (keyIds.length > 0) {
    const named = keyIds.flatMap((id) => {
      const item = detail.items[id];
      if (!item) return [];
      const map = groups.find((group) => group.ids.includes(id))?.map;
      const where = map && detail.maps[map] && labels.length > 1 ? ` for ${detail.maps[map].name}` : "";
      const price = item.buy ? ` (about ${formatRoubles(roughly(item.buy.price))}${item.buy.vendor === "Flea Market" ? " on the flea market" : ` from ${item.buy.vendor}`})` : "";
      return [`the ${item.name}${where}${price}`];
    });
    if (named.length > 0) bring.push(`Bring ${listed(named, 4)}.`);
  }
  const needs = needPhrases(detail);
  const items = quest.needs.reduce((total, need) => total + (isMoney(detail, need) ? 0 : need.count), 0);
  const names = singleItemNames(detail);
  if (needs.length > 6 && names.length >= 3) bring.push(`You ${needVerb(detail).toLowerCase()} ${plural(items, "item")} in all, ${listed(names.slice(0, 3), 3)} among them; the full list is below.`);
  else if (needs.length > 0) bring.push(`You ${needVerb(detail).toLowerCase()} ${listed(needs, 6)}.`);
  const fir = firCount(detail);
  if (fir > 0) {
    bring.push(
      fir === 1
        ? "The found-in-raid item has to come out of your own raid: one bought from a trader or the flea market won't count."
        : `The ${fir} found-in-raid items have to come out of your own raids: ones bought from a trader or the flea market won't count, so keep them as you loot.`
    );
  }
  const cost = buyCost(detail);
  if (cost) bring.push(`Buying the ${fir > 0 ? "rest" : "items"} costs about ${formatRoubles(roughly(cost))} at current prices.`);
  if (bring.length === 0) bring.push("There's nothing to hand over and no key to bring.");
  paragraphs.push(bring.join(" "));

  const notes: string[] = [];
  // Only objectives tied to one map each: one that takes any of several maps can be done in one raid.
  const objectiveMaps = new Set(
    detail.objectives.flatMap((objective) => {
      const labels = mapLabels(objective.maps, detail.maps);
      return !objective.optional && labels.length === 1 && labels[0] !== ANY_MAP ? labels : [];
    })
  );
  if (objectiveMaps.size > 1) notes.push(`The objectives are spread over ${objectiveMaps.size} maps, so plan on more than one raid.`);
  if (detail.objectives.some((objective) => objective.conditions.length > 0)) {
    notes.push("Some objectives only count with particular gear, a weapon, mods or what you wear, so check them before you load out.");
  }
  if (options.buildPage) notes.push("One objective asks for a weapon built to spec; there's a ready build for it.");
  const questItems = Array.from(new Set(detail.objectives.flatMap((objective) => (objective.questItem ? [objective.questItem.name] : []))));
  if (questItems.length > 0) notes.push(`You pick up ${listed(questItems, 2)} in raid and have to extract with ${questItems.length === 1 ? "it" : "them"}.`);
  const failedBy = quest.failedBy.map((entry) => detail.quests[entry.id]?.name).filter((entry): entry is string => Boolean(entry));
  if (failedBy.length > 0) notes.push(`Completing ${listed(failedBy, 2)} fails this one, so pick your branch.`);
  const optional = detail.objectives.filter((objective) => objective.optional).length;
  if (optional > 0) notes.push(`${plural(optional, "objective is", "objectives are")} optional.`);
  if (notes.length > 0) paragraphs.push(notes.slice(0, 3).join(" "));

  const next = detail.unlocks.map((entry) => detail.quests[entry.id]?.name).filter((entry): entry is string => Boolean(entry));
  const { unlock, goods } = mainRewards(detail);
  const paid = [quest.experience > 0 ? `${quest.experience.toLocaleString("en-US")} XP` : null, ...goods].filter((entry): entry is string => entry !== null);
  const outro: string[] = [];
  if (paid.length > 0) outro.push(`Completing it gives ${listed(paid)}${unlock ? `${paid.length > 1 ? "," : ""} and unlocks ${unlock}` : ""}.`);
  else if (unlock) outro.push(`Completing it unlocks ${unlock}.`);
  outro.push(next.length > 0 ? `It leads to ${listed(next, 4)}.` : "No other quest follows from it.");
  if (quest.kappaRequired && quest.lightkeeperRequired) outro.push("You need it for both the Kappa container and Lightkeeper.");
  else if (quest.kappaRequired) outro.push("You need it for the Kappa container.");
  else if (quest.lightkeeperRequired) outro.push("You need it for Lightkeeper, though not for Kappa.");
  else outro.push("It isn't needed for the Kappa container.");
  paragraphs.push(outro.join(" "));
  return paragraphs;
}

export function questFaq(detail: QuestDetail): FaqEntry[] {
  const { quest } = detail;
  const name = questName(quest);
  const ref = (id: string) => detail.quests[id]?.name;
  const entries: FaqEntry[] = [];
  if (quest.trader) {
    const before = detail.prerequisites
      .map((requirement) => (ref(requirement.id) ? `${requirementLabel(requirement.status)} ${ref(requirement.id)}` : null))
      .filter((entry): entry is string => Boolean(entry));
    entries.push({
      question: `Who gives ${name} in Tarkov?`,
      answer:
        `${quest.trader} gives ${name}` +
        (quest.minPlayerLevel > 1 ? `, from player level ${quest.minPlayerLevel}` : "") +
        (quest.faction ? `, to ${quest.faction} players only` : "") +
        "." +
        (before.length ? ` First ${listed(before)}.` : " No other quest has to be done first."),
    });
  }
  const keys = Array.from(new Set(quest.keys.flatMap((entry) => entry.keys))).map((id) => detail.items[id]?.name).filter(Boolean) as string[];
  if (quest.needs.length > 0 || keys.length > 0) {
    const parts: string[] = [];
    if (quest.needs.length > 0) parts.push(`${needVerb(detail)} ${listed(needPhrases(detail))}.`);
    if (keys.length > 0) parts.push(`Bring the ${listed(keys)}.`);
    entries.push({ question: `What items do you need for ${name}?`, answer: parts.join(" ") });
  }
  const rewards = rewardPhrases(detail, detail.rewards);
  if (rewards.length > 0) {
    entries.push({ question: `What are the rewards for ${name}?`, answer: `${listed(rewards, 8)}.` });
  }
  if (quest.kappaRequired) {
    entries.push({
      question: `Is ${name} needed for Kappa?`,
      answer: `Yes. tarkov.dev lists ${name} among the quests needed for the Kappa secure container.`,
    });
  }
  const next = detail.unlocks.map((entry) => ref(entry.id)).filter((entry): entry is string => Boolean(entry));
  if (next.length > 0) {
    entries.push({ question: `What does ${name} unlock?`, answer: `It leads to ${listed(next, 6)}.` });
  }
  const failedBy = quest.failedBy.map((entry) => ref(entry.id)).filter((entry): entry is string => Boolean(entry));
  if (failedBy.length > 0) {
    entries.push({
      question: `Can ${name} fail?`,
      answer: `Yes. Completing ${listed(failedBy)} fails ${name}, so choose one branch.`,
    });
  }
  return entries;
}

export function questHubFaq(list: QuestList | null): FaqEntry[] {
  const kappa = list?.quests.filter((quest) => quest.kappaRequired) ?? [];
  const entries: FaqEntry[] = [
    {
      question: "How does the quest tracker work?",
      answer:
        "Mark quests complete and the tracker works out what's available to you now from each quest's prerequisites, your level and your faction. Completing a quest also marks the quests it needed first. Progress is saved in this browser, separately for PVP and PVE.",
    },
    {
      question: "Which items should I keep for quests?",
      answer:
        "The items needed view adds up every item your remaining quests take, split into items that must be found in raid and items you can buy or craft, with the quests that need each one. Items found in raid only count while they keep their found-in-raid mark.",
    },
  ];
  if (kappa.length > 0) {
    entries.push({
      question: "Which quests are needed for Kappa?",
      answer: `tarkov.dev lists ${plural(kappa.length, "quest")} as needed for the Kappa container: ${listed(
        kappa.map((quest) => quest.name),
        kappa.length
      )}.`,
    });
  }
  entries.push({
    question: "Are PVP and PVE quests the same?",
    answer:
      "Mostly. Each mode has a few quests of its own, such as the PVP and PVE zone quests, and some objectives and rewards differ. Use the PVP / PVE switch in the header: the list, your progress and the items needed all follow it.",
  });
  return entries;
}
