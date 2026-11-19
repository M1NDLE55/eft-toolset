import type { WikiPageSection } from "@/app/lib/wiki/page-sections";
import type { QuestWikiPageImage } from "@/app/lib/wiki/quest-wiki";
import type { QuestWikiImage } from "@/app/lib/wiki/wiki-images";
import type { QuestMap, QuestObjective } from "./types";

export interface PlacedWikiImages {
  /** Images that sit in a section the page shows, keyed by `sectionKey`. */
  sections: Map<string, QuestWikiImage[]>;
  /** Images matched to one objective, by objective id. */
  objectives: Record<string, QuestWikiImage[]>;
  /** The rest, from sections the page leaves out (such as Requirements), by section in page order. */
  other: { section: string; images: QuestWikiImage[] }[];
}

const norm = (text: string) => text.trim().toLowerCase();

/**
 * One block of a page's rendered sections: a section, or a subsection of it. The occurrences tell apart
 * headings a page repeats (see groupWikiSections).
 */
export function sectionKey(section: string, sectionOccurrence = 0, subsection: string | null = null, subsectionOccurrence = 0) {
  const key = `${norm(section)}#${sectionOccurrence}`;
  return subsection === null ? key : `${key}\n${norm(subsection)}#${subsectionOccurrence}`;
}

/** Only the fields the client needs: nothing else of the page data reaches the browser with them. */
function pick(image: QuestWikiPageImage): QuestWikiImage {
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
  images: readonly QuestWikiPageImage[],
  rendered: readonly WikiPageSection[],
  objectives: QuestObjective[],
  maps: Record<string, QuestMap>
): PlacedWikiImages {
  const placed: PlacedWikiImages = { sections: new Map(), objectives: {}, other: [] };
  const known = new Set<string>();
  for (const section of rendered) {
    known.add(sectionKey(section.heading, section.occurrence));
    for (const subsection of section.subsections) {
      known.add(sectionKey(section.heading, section.occurrence, subsection.heading, subsection.occurrence));
    }
  }
  for (const entry of images) {
    const image = pick(entry);
    const inSection = sectionKey(entry.section, entry.sectionOccurrence);
    const inSubsection =
      entry.subsection === null ? null : sectionKey(entry.section, entry.sectionOccurrence, entry.subsection, entry.subsectionOccurrence);
    const key = inSubsection !== null && known.has(inSubsection) ? inSubsection : known.has(inSection) ? inSection : null;
    if (key !== null) {
      placed.sections.set(key, [...(placed.sections.get(key) ?? []), image]);
      continue;
    }
    const objective = matchObjective(image, objectives, maps);
    if (objective) (placed.objectives[objective.id] ??= []).push(image);
    else {
      const group = placed.other.find((other) => norm(other.section) === norm(image.section));
      if (group) group.images.push(image);
      else placed.other.push({ section: image.section, images: [image] });
    }
  }
  return placed;
}
