import { questName, questTitleName, requirementLabel } from "@/app/lib/quests/display";
import { moneyLabel } from "@/app/lib/quests/shopping-list";
import type { QuestDetail, QuestItemNeed, QuestList, QuestRewards } from "@/app/lib/quests/types";
import type { FaqEntry } from "./item";
import { plural } from "./format";

export const QUEST_HUB_NAME = "Quests";
export const QUEST_HUB_TITLE = "Tarkov Quest Tracker: Every Quest, Items Needed & Chains";
export const QUEST_HUB_DESCRIPTION =
  "Every Escape from Tarkov quest by trader, map and level, with what's available to you now, every item to keep (found in raid marked), each trader's quest chain, and progress saved in your browser for PVP and PVE.";

const MAX_DESCRIPTION = 160;
const MAX_LISTED = 4;

export function questTitle(detail: Pick<QuestDetail, "quest">) {
  return `${questTitleName(detail.quest)} Quest: Objectives, Items & Rewards`;
}

function listed(names: string[], max = MAX_LISTED) {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function needText(detail: QuestDetail, need: QuestItemNeed) {
  const fir = need.foundInRaid ? " (found in raid)" : "";
  if (need.items.length === 1 && need.alternatives === undefined) {
    const id = need.items[0];
    return moneyLabel(id, need.count) ?? `${need.count}× ${detail.items[id]?.name ?? "item"}${fir}`;
  }
  const names = need.items.map((id) => detail.items[id]?.name).filter((name): name is string => Boolean(name));
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

export function questDescription(detail: QuestDetail) {
  const { quest } = detail;
  const name = questName(quest);
  const who = [
    quest.trader ? `${quest.trader} quest` : "Quest",
    quest.minPlayerLevel > 1 ? ` from level ${quest.minPlayerLevel}` : "",
    quest.faction ? `, ${quest.faction} only` : "",
  ].join("");
  const fir = quest.needs.filter((need) => need.foundInRaid).length;
  const facts = [
    plural(detail.objectives.filter((objective) => !objective.optional).length, "objective"),
    quest.needs.length > 0 ? `${plural(quest.needs.length, "item to hand over", "items to hand over")}${fir ? ` (${fir} found in raid)` : ""}` : null,
    quest.kappaRequired ? "needed for Kappa" : null,
  ].filter(Boolean);
  const rewards = rewardPhrases(detail, detail.rewards).slice(0, 2);
  let text = `${name}: ${who}. ${facts.join(", ")}.`;
  if (rewards.length) text += ` Rewards: ${rewards.join(", ")}.`;
  const tail = " Items, keys, maps and guide.";
  return text.length + tail.length <= MAX_DESCRIPTION ? text + tail : text;
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
    if (quest.needs.length > 0) parts.push(`Hand over ${listed(quest.needs.map((need) => needText(detail, need)))}.`);
    if (keys.length > 0) parts.push(`Bring ${listed(keys)}.`);
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
