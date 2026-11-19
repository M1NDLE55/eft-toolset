import type { WikiPageSection } from "@/app/lib/wiki/page-sections";
import type { QuestWikiImage } from "@/app/lib/wiki/wiki-images";
import type { QuestMap, QuestObjective } from "./types";

export interface PlacedWikiImages {
  /** Images that sit in a section the page shows, keyed by `sectionKey`. */
  sections: Map<string, QuestWikiImage[]>;
  /** Images matched to one objective, by objective id. */
  objectives: Record<string, QuestWikiImage[]>;
  /** The rest, from sections the page leaves out (such as Objectives). */
  other: QuestWikiImage[];
}

const norm = (text: string) => text.trim().toLowerCase();

/** Where an image goes among a page's rendered sections: a subsection's heading, or null for the section itself. */
export function sectionKey(section: string, subsection: string | null) {
  return subsection === null ? norm(section) : `${norm(section)}\n${norm(subsection)}`;
}

/** Only the fields the client needs: nothing else of the page data reaches the browser with them. */
function pick(image: QuestWikiImage): QuestWikiImage {
  const { file, hashPath, caption, section, subsection, uploader, filePage } = image;
  return { file, hashPath, caption, section, subsection, uploader, filePage };
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Objective map names as the checklist shows them: variants share their page map's name. */
function objectiveMapNames(objective: QuestObjective, maps: Record<string, QuestMap>) {
  return new Set(objective.maps.map((key) => (maps[key]?.page && maps[maps[key].page!]?.name) || maps[key]?.name || key));
}

/**
 * The one objective an image shows, when its subsection or caption (or failing those, its file name) names
 * exactly one of the quest's maps and only one objective is on that map. Otherwise null.
 */
function matchObjective(image: QuestWikiImage, objectives: QuestObjective[], maps: Record<string, QuestMap>) {
  const byMap = new Map<string, QuestObjective[]>();
  for (const objective of objectives) {
    for (const name of objectiveMapNames(objective, maps)) byMap.set(name, [...(byMap.get(name) ?? []), objective]);
  }
  const names = (text: string) =>
    Array.from(byMap.keys()).filter((name) => new RegExp(`(^|[^a-z0-9])${escape(name.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase()));
  let named = names([image.subsection, image.caption].filter(Boolean).join(" "));
  if (named.length === 0) named = names(image.file.replace(/[_-]/g, " ").replace(/\.\w+$/, ""));
  if (named.length !== 1) return null;
  const onMap = byMap.get(named[0])!;
  return onMap.length === 1 ? onMap[0] : null;
}

/**
 * Places a quest's wiki images: with the guide section (or subsection) they sit in when the page shows it;
 * otherwise under the one objective they clearly show, or else in a block by the objectives.
 */
export function placeWikiImages(
  images: readonly QuestWikiImage[],
  rendered: readonly WikiPageSection[],
  objectives: QuestObjective[],
  maps: Record<string, QuestMap>
): PlacedWikiImages {
  const placed: PlacedWikiImages = { sections: new Map(), objectives: {}, other: [] };
  const known = new Set<string>();
  for (const section of rendered) {
    known.add(sectionKey(section.heading, null));
    for (const subsection of section.subsections) known.add(sectionKey(section.heading, subsection.heading));
  }
  for (const image of images.map(pick)) {
    let key: string | null = sectionKey(image.section, image.subsection);
    if (!known.has(key)) key = known.has(sectionKey(image.section, null)) ? sectionKey(image.section, null) : null;
    if (key !== null) {
      placed.sections.set(key, [...(placed.sections.get(key) ?? []), image]);
      continue;
    }
    const objective = matchObjective(image, objectives, maps);
    if (objective) (placed.objectives[objective.id] ??= []).push(image);
    else placed.other.push(image);
  }
  return placed;
}
