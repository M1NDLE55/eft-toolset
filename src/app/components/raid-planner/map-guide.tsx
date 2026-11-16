import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import type { MapDetails, MapExtract } from "@/app/lib/types/raidPlanner";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { isItemSlug } from "@/app/lib/item-links";
import { formatChance, isNamedBoss, mapIntro, type MapGuide as Guide } from "@/app/lib/seo/map";
import type { FaqEntry } from "@/app/lib/seo/item";
import { formatRoubles, plural } from "@/app/lib/seo/format";

export const MAP_GUIDE_ID = "map-guide";
/** Height of the strip under the map that links down to the guide. */
export const MAP_GUIDE_STRIP_CLASS = "h-11";

const heading = "text-xs font-bold uppercase tracking-widest text-[#9a8866]";
const panel = "border border-[#1a1a1a] bg-[#0c0c0c]";

function transferText(extract: MapExtract) {
  const item = extract.transferItem;
  if (!item) return null;
  if (/^roubles?$/i.test(item.name)) return `Costs ${formatRoubles(item.count)}`;
  return `Needs ${item.count > 1 ? `${item.count}× ` : ""}${item.name}`;
}

function ExtractList({ title, extracts }: { title: string; extracts: MapExtract[] }) {
  if (extracts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#bbb]">
        {title} <span className="text-[#666]">· {extracts.length}</span>
      </h3>
      <ul className={`${panel} divide-y divide-[#151515] text-sm`}>
        {extracts.map((extract) => {
          const transfer = transferText(extract);
          return (
            <li key={extract.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span className="text-[#ccc]">{extract.name}</span>
              {transfer && <span className="shrink-0 text-xs text-[#888]">{transfer}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MapGuideStrip({ config }: { config: MapConfig }) {
  return (
    <a
      href={`#${MAP_GUIDE_ID}`}
      className={`${MAP_GUIDE_STRIP_CLASS} flex items-center justify-center gap-2 border-t border-[#1a1a1a] bg-[#070707] text-[10px] font-bold uppercase tracking-widest text-[#9a8866] hover:text-[#c9b88d] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9a8866]`}
    >
      {config.name} extracts, bosses and keys
      <ChevronDown className="h-4 w-4" aria-hidden />
    </a>
  );
}

function OtherMaps({ config }: { config: MapConfig }) {
  return (
    <nav aria-labelledby="other-maps" className="flex flex-col gap-3">
      <h2 id="other-maps" className={heading}>
        Other Tarkov maps
      </h2>
      <ul className="flex flex-wrap gap-2">
        {mapConfigs
          .filter((map) => map.key !== config.key)
          .map((map) => (
            <li key={map.key}>
              <Link
                href={`/raid-planner/map/${map.key}`}
                className="inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
              >
                {map.name} map
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}

/** Shown while the map's data loads, or when it can't be loaded on the server. */
export function MapGuideFallback({ config }: { config: MapConfig }) {
  return (
    <section id={MAP_GUIDE_ID} aria-labelledby="map-guide-title" className="flex justify-center px-4 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h2 id="map-guide-title" className="text-xl font-black uppercase tracking-widest text-[#e6d9b8]">
            {config.name} map guide
          </h2>
          <p className="max-w-3xl text-sm text-[#999]">
            This interactive {config.name} map for Escape from Tarkov shows every extract, transit, PMC and Scav spawn,
            boss spawn, locked door and key, hazard and loot container. Toggle them in the layers panel, switch floors,
            or press Plan to draw a route and share it with your squad.
          </p>
        </div>
        <OtherMaps config={config} />
      </div>
    </section>
  );
}

/** A written guide under the interactive map, from the same data: indexable and quick to scan. */
export function MapGuide({
  config,
  details,
  guide,
  faq,
}: {
  config: MapConfig;
  details: MapDetails;
  guide: Guide;
  faq: FaqEntry[];
}) {
  const name = config.name;
  return (
    <section id={MAP_GUIDE_ID} aria-labelledby="map-guide-title" className="flex justify-center px-4 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h2 id="map-guide-title" className="text-xl font-black uppercase tracking-widest text-[#e6d9b8]">
            {name} map guide
          </h2>
          <p className="max-w-3xl text-sm text-[#999]">{mapIntro(name, details, guide)}</p>
        </div>

        {(guide.extracts.pmc.length > 0 || guide.extracts.scav.length > 0 || guide.extracts.shared.length > 0) && (
          <section aria-labelledby="map-extracts" className="flex flex-col gap-3">
            <h2 id="map-extracts" className={heading}>
              {name} extracts
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <ExtractList title="PMC extracts" extracts={guide.extracts.pmc} />
              <ExtractList title="Scav extracts" extracts={guide.extracts.scav} />
              <ExtractList title="PMC and Scav" extracts={guide.extracts.shared} />
            </div>
          </section>
        )}

        {details.transits.length > 0 && (
          <section aria-labelledby="map-transits" className="flex flex-col gap-3">
            <h2 id="map-transits" className={heading}>
              {name} transits
            </h2>
            <ul className={`${panel} divide-y divide-[#151515] text-sm`}>
              {details.transits.map((transit) => (
                <li key={transit.id} className="flex flex-col gap-0.5 px-3 py-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="text-[#ccc]">{transit.description}</span>
                  {transit.conditions && <span className="text-xs text-[#888]">{transit.conditions}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {guide.bosses.length > 0 && (
          <section aria-labelledby="map-bosses" className="flex flex-col gap-3">
            <h2 id="map-bosses" className={heading}>
              {guide.bosses.some(isNamedBoss) ? `${name} bosses and spawn chances` : `${name} special spawns`}
            </h2>
            <ul className={`${panel} divide-y divide-[#151515] text-sm`}>
              {guide.bosses.map((boss) => {
                const locations = Array.from(new Set(boss.locations.map((location) => location.name))).filter(Boolean);
                return (
                  <li key={boss.name} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-[#ddd]">{boss.name}</span>
                      <span className="shrink-0 tabular-nums text-[#e6d9b8]">{formatChance(boss.spawnChance)}</span>
                    </span>
                    {(locations.length > 0 || boss.escorts > 0) && (
                      <span className="text-xs text-[#888]">
                        {locations.length > 0 && `Spawns at ${locations.join(", ")}`}
                        {locations.length > 0 && boss.escorts > 0 && " · "}
                        {boss.escorts > 0 && `up to ${plural(boss.escorts, "guard")}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {guide.keys.length > 0 && (
          <section aria-labelledby="map-keys" className="flex flex-col gap-3">
            <div>
              <h2 id="map-keys" className={heading}>
                {name} keys
              </h2>
              <p className="mt-1 text-xs text-[#888]">
                {plural(guide.keys.length, "key")} open locks on {name}
                {guide.powerLocks > 0 && `, and ${plural(guide.powerLocks, "lock")} also ${guide.powerLocks === 1 ? "needs" : "need"} power`}
                . Open a key for its price and the tasks that need it.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              {guide.keys.map((key) => (
                <li key={key.name} className="flex items-baseline justify-between gap-2 border-b border-[#151515] py-1.5 text-sm">
                  {key.normalizedName && isItemSlug(key.normalizedName) ? (
                    <Link href={`/item/${key.normalizedName}`} className="truncate text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                      {key.name}
                    </Link>
                  ) : (
                    <span className="truncate text-[#ccc]">{key.name}</span>
                  )}
                  {key.locks > 1 && <span className="shrink-0 text-xs text-[#666]">{key.locks} locks</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {faq.length > 0 && (
          <section aria-labelledby="map-faq" className="flex flex-col gap-3">
            <h2 id="map-faq" className={heading}>
              {name} questions
            </h2>
            <dl className={`${panel} flex flex-col divide-y divide-[#1a1a1a]`}>
              {faq.map((entry) => (
                <div key={entry.question} className="flex flex-col gap-1 px-3 py-2.5">
                  <dt className="text-sm font-semibold text-[#ddd]">{entry.question}</dt>
                  <dd className="text-sm text-[#999]">{entry.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <OtherMaps config={config} />
      </div>
    </section>
  );
}
