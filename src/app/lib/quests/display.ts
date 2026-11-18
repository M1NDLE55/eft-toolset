import type { Faction, RequirementStatus } from "./types";

/** A quest's name, told apart from others that share it by its prestige level (New Beginning). */
export function questName(quest: { name: string; prestige?: number | null }) {
  return quest.prestige ? `${quest.name} (Prestige ${quest.prestige})` : quest.name;
}

/** The name with its faction, for titles where no badge can say it. */
export function questTitleName(quest: { name: string; prestige?: number | null; faction: Faction | null }) {
  return quest.faction ? `${questName(quest)} (${quest.faction})` : questName(quest);
}

/** What a requirement asks of the other quest, as a short phrase. */
export function requirementLabel(status: readonly RequirementStatus[]) {
  const complete = status.includes("complete");
  const active = status.includes("active");
  const failed = status.includes("failed");
  if (complete && failed) return "complete or fail";
  if (complete && active) return "start or complete";
  if (complete) return "complete";
  if (active) return "start";
  return "fail";
}

/** "Level 15" for a level requirement; nothing for quests open from the start. */
export function levelLabel(level: number) {
  return level > 1 ? `Level ${level}` : null;
}

/**
 * For an objective that names its one item ("Hand over the found in raid item: Salewa"), the
 * words before and after the name, so the name can link to the item; null when it isn't named.
 */
export function aroundItemName(description: string, name: string | null | undefined) {
  if (!name) return null;
  const at = description.lastIndexOf(name);
  if (at < 0) return null;
  return { before: description.slice(0, at), after: description.slice(at + name.length) };
}
