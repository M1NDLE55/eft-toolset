import type { QuestWikiPageImage } from "@/app/lib/wiki/quest-wiki";
import type { QuestWikiImage } from "@/app/lib/wiki/wiki-images";
import type { QuestMap, QuestObjective } from "./types";

export interface PlacedWikiImages {
  /** Images that clearly show one objective, by objective id, in page order. */
  objectives: Record<string, QuestWikiImage[]>;
  /**
   * The rest, for a strip under the objectives: runs of images from one part of the page, labelled with its
   * subsection (or section, other than the guide itself) when it has one.
   */
  strip: { label: string | null; images: QuestWikiImage[] }[];
}

/** Only the fields the client needs: nothing else of the page data reaches the browser with them. */
function pick(image: QuestWikiPageImage): QuestWikiImage {
  const { file, hashPath, caption, section, subsection, uploader, filePage } = image;
  return { file, hashPath, caption, section, subsection, uploader, filePage };
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The name a map goes by in captions: its page map's (Night Factory is Factory), and shorter forms of it. */
function mapNames(key: string, maps: Record<string, QuestMap>) {
  const map = maps[key];
  const name = (map?.page && maps[map.page]?.name) || map?.name || key;
  const names = new Set([name.toLowerCase()]);
  const short = name.replace(/^the\s+/i, "").replace(/\s+of\s+tarkov$/i, "");
  if (short.length >= 4) names.add(short.toLowerCase());
  return names;
}

// Words that say where in general, not which place: shared by too many captions and objectives to tell them apart.
const GENERIC = new Set(
  "the and for from with into onto near next behind inside outside under above below over left right top bottom side first second third one two three marked map location locate locations spot place area room floor building way path here there where this that these those its are you your can find found obtain get stash plant hand over item items any quest".split(
    " "
  )
);

function words(text: string, ignore: ReadonlySet<string>) {
  const result = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || (raw.length < 3 && !/^\d+$/.test(raw))) continue;
    const word = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (!GENERIC.has(word) && !ignore.has(word)) result.add(word);
  }
  return result;
}

/**
 * Objectives a picture could show: those on a map, other than surviving the raid. Handing items over happens
 * at the trader, so nothing to picture there.
 */
function placeObjectives(objectives: QuestObjective[]) {
  return objectives.filter((objective) => objective.maps.length > 0 && objective.type !== "extract");
}

const GUIDE = /guide/i;

/**
 * Places a quest's wiki images by the objectives, each image once. An image goes under an objective when:
 *
 * 1. its subsection or caption (or failing those, its file name) names a map, and only one of the objectives
 *    a picture could show is on it; or several are and the caption's words name only one of them;
 * 2. it names no map, and its caption has words that only one objective's description has;
 * 3. it names neither but follows, in the same part of the page, an image that went under an objective (the
 *    wiki shows each step's map, then the steps there), and its caption's words don't point at other objectives;
 * 4. none of that, it's in the guide, only one objective is on a map at all and the words don't point elsewhere.
 *
 * Anything else, such as an image naming a map no objective is on, goes in the strip under the objectives.
 */
export function placeWikiImages(images: readonly QuestWikiPageImage[], objectives: QuestObjective[], maps: Record<string, QuestMap>): PlacedWikiImages {
  const placed: PlacedWikiImages = { objectives: {}, strip: [] };
  const candidates = placeObjectives(objectives);
  const names = new Map(candidates.map((objective) => [objective, new Set(objective.maps.flatMap((key) => [...mapNames(key, maps)]))]));
  // Every map the quest's data mentions, so an image naming one no objective is on isn't taken for a step there.
  const allNames = new Set([...Object.keys(maps).flatMap((key) => [...mapNames(key, maps)]), ...Array.from(names.values(), (set) => [...set]).flat()]);
  const mapWords = new Set([...allNames].flatMap((name) => name.split(/\s+/)));
  const descriptionWords = new Map(candidates.map((objective) => [objective, words(objective.description, mapWords)]));
  const named = (text: string) =>
    Array.from(allNames).filter((name) => new RegExp(`(^|[^a-z0-9])${escape(name)}($|[^a-z0-9])`).test(text.toLowerCase()));

  /**
   * What the caption's words say among `among`: the one objective whose description has words no other one of them
   * has (or null), and every objective sharing any word with it.
   */
  const byWords = (image: QuestWikiImage, among: QuestObjective[]) => {
    const said = words([image.subsection, image.caption].filter(Boolean).join(" "), mapWords);
    let best: QuestObjective | null = null;
    let bestScore = 0;
    let tied = false;
    const touched = new Set<QuestObjective>();
    for (const objective of among) {
      const own = descriptionWords.get(objective)!;
      let score = 0;
      for (const word of said) {
        if (!own.has(word)) continue;
        touched.add(objective);
        if (among.every((other) => other === objective || !descriptionWords.get(other)!.has(word))) score += 1;
      }
      if (score > bestScore) [best, bestScore, tied] = [objective, score, false];
      else if (score > 0 && score === bestScore) tied = true;
    }
    return { best: tied ? null : best, touched };
  };
  /** `objective`, unless the caption's words point at other objectives and not at it. */
  const unlessOthers = (objective: QuestObjective | null, touched: ReadonlySet<QuestObjective>) =>
    objective && (touched.size === 0 || touched.has(objective)) ? objective : null;

  // The last image's part of the page and objective, for the next image there to follow.
  let previous = null as { block: string; objective: QuestObjective | null } | null;
  for (const entry of images) {
    const image = pick(entry);
    const block = [entry.section, entry.sectionOccurrence ?? 0, entry.subsection, entry.subsectionOccurrence ?? 0].join("\u0000");
    let mapsNamed = named([image.subsection, image.caption].filter(Boolean).join(" "));
    if (mapsNamed.length === 0) mapsNamed = named(image.file.replace(/\.\w+$/, "").replace(/[_-]+/g, " "));
    let objective: QuestObjective | null = null;
    if (mapsNamed.length > 0) {
      const onMap = candidates.filter((candidate) => mapsNamed.some((name) => names.get(candidate)!.has(name)));
      objective = onMap.length === 1 ? onMap[0] : onMap.length > 1 ? byWords(image, onMap).best : null;
    } else {
      const { best, touched } = byWords(image, candidates);
      objective =
        best ??
        unlessOthers(previous?.block === block ? previous.objective : null, touched) ??
        unlessOthers(candidates.length === 1 && GUIDE.test(image.section) ? candidates[0] : null, touched);
    }
    previous = { block, objective };
    if (objective) {
      (placed.objectives[objective.id] ??= []).push(image);
      continue;
    }
    const label = image.subsection ?? (GUIDE.test(image.section) ? null : image.section);
    const last = placed.strip.at(-1);
    if (last && last.label === label) last.images.push(image);
    else placed.strip.push({ label, images: [image] });
  }
  return placed;
}
