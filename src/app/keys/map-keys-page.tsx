import type { Metadata } from "@/app/lib/seo/metadata";
import Image from "@/app/lib/navigation/image";
import Link from "@/app/lib/navigation/link";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { ServerModeNote } from "@/components/game-mode/server-mode-note";
import type { GameMode } from "@/components/game-mode/mode";
import type { KeyCount, MapKeys } from "@/app/lib/reference/keys";
import { Rubles } from "@/app/lib/currency";
import { formatRoubles, plural } from "@/app/lib/seo/format";
import type { FaqEntry } from "@/app/lib/seo/item";
import { FaqSection } from "@/app/components/seo/faq-section";
import { ItemRundownLink } from "@/app/components/item/rundown/rundown-link";

export function keysFaq(map: MapKeys): FaqEntry[] {
  const entries: FaqEntry[] = [];
  const forTasks = map.keys.filter((key) => key.tasks.length > 0);
  if (forTasks.length) {
    entries.push({
      question: `Which ${map.name} keys are needed for quests?`,
      answer: `${forTasks.map((key) => `${key.name} (${key.tasks.join(", ")})`).join("; ")}.`,
    });
  }
  const priced = map.keys.filter((key) => key.buyPrice !== null);
  if (priced.length) {
    const top = priced[0];
    entries.push({
      question: `What is the most expensive ${map.name} key?`,
      answer: `${top.name}, at about ${formatRoubles(top.buyPrice!)} to buy${top.buySource ? ` from ${top.buySource === "Flea Market" ? "the flea market" : top.buySource}` : ""}.`,
    });
  }
  entries.push({
    question: `How many keys are there on ${map.name}?`,
    answer: `${plural(map.keys.length, "key")} open locks on ${map.name}. The interactive map's key layer shows each locked door and which key opens it.`,
  });
  return entries;
}

export interface MapKeysPageData {
  gameMode: GameMode;
  config: { key: string; name: string };
  keys: MapKeys & { gameMode: GameMode };
  /** Other maps with a keys page. */
  otherMaps: KeyCount[];
  /** Quest pages for the tasks the keys list, by task name; null for a name several quests share. */
  questSlugs: Record<string, string | null>;
  metadata: Metadata;
}

export function MapKeysPage({ data }: { data: MapKeysPageData }) {
  const { config, keys: loaded, otherMaps } = data;
  const questSlugs = new Map(Object.entries(data.questSlugs));
  const faq = keysFaq(loaded);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: "Keys by map", path: "/keys" },
          { name: `${config.name} keys`, path: `/keys/${config.key}` },
        ])}
      />
      <JsonLd data={faqPage(faq)} />
      <nav aria-label="Breadcrumb" className="-mb-4 text-2xs uppercase tracking-widest text-[#777]">
        <Link href="/keys" className="hover:text-[#c8b384] hover:underline underline-offset-2">
          Keys by map
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">{config.name} keys</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          Every key that opens a lock on {config.name}, most expensive first, with what it costs, what it sells for and
          the tasks that need it. See where each lock is on the{" "}
          <Link href={`/raid-planner/map/${config.key}`} className="text-[#c8b384] underline underline-offset-2">
            interactive {config.name} map
          </Link>
          . <ServerModeNote rendered={loaded.gameMode} />
        </p>
      </header>
      <div className="overflow-x-auto border border-[#1a1a1a] bg-[#0c0c0c]">
        <table className="w-full min-w-144 text-sm">
          <thead className="text-3xs uppercase tracking-widest text-[#666]">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-bold">Key</th>
              <th scope="col" className="px-2 py-1.5 text-right font-bold">Locks</th>
              <th scope="col" className="px-2 py-1.5 text-right font-bold">Buy</th>
              <th scope="col" className="px-2 py-1.5 text-right font-bold">Sells for</th>
              <th scope="col" className="px-3 py-1.5 text-left font-bold">Needed for</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {loaded.keys.map((key) => (
              <tr key={key.name} className="hover:bg-[#100f0c]">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#111]">
                      {key.gridImageLink && <Image src={key.gridImageLink} alt="" width={32} height={32} className="max-h-8 w-auto" />}
                    </span>
                    {key.slug ? (
                      <ItemRundownLink
                        item={{ name: key.name, normalizedName: key.slug }}
                        className="text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline"
                      >
                        {key.name}
                      </ItemRundownLink>
                    ) : (
                      <span className="text-[#ccc]">{key.name}</span>
                    )}
                  </span>
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums text-[#aaa]">{key.locks}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className="block tabular-nums text-[#ddd]">{key.buyPrice === null ? "—" : Rubles.format(key.buyPrice)}</span>
                  <span className="block text-3xs text-[#777]">{key.buySource === "Flea Market" ? "Flea" : (key.buySource ?? "Loot only")}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[#aaa]">{key.sellPrice === null ? "—" : Rubles.format(key.sellPrice)}</td>
                <td className="px-3 py-1.5 text-xs text-[#999]">
                  {key.tasks.length
                    ? key.tasks.map((task, index) => {
                        const slug = questSlugs.get(task);
                        return (
                          <span key={task}>
                            {index > 0 && ", "}
                            {slug ? (
                              <Link href={`/quests/${slug}`} className="underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                                {task}
                              </Link>
                            ) : (
                              task
                            )}
                          </span>
                        );
                      })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FaqSection id="keys-faq" title={`${config.name} key questions`} entries={faq} />
      <nav aria-label="Keys on other maps" className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">Keys on other maps</h2>
        <ul className="flex flex-wrap gap-2">
          {otherMaps.map((map) => (
              <li key={map.key}>
                <Link
                  href={`/keys/${map.key}`}
                  className="inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
                >
                  {map.name} keys
                </Link>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  );
}
