import type { Metadata } from "next";
import type { ReactNode } from "react";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

export const metadata: Metadata = {
  title: "Credits",
  description: "The data, maps, and software that EFT Toolset is built on, with their licences.",
  alternates: { canonical: "/credits" },
};

const CC_BY_NC_SA_4 = "https://creativecommons.org/licenses/by-nc-sa/4.0/";

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} rel="noopener noreferrer" className="text-[#9a8866] underline underline-offset-2 hover:text-[#e6d9b8]">
      {children}
    </a>
  );
}

function mapNames(filter: (map: (typeof mapConfigs)[number]) => boolean) {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(mapConfigs.filter(filter).map((map) => map.name));
}

const sections: { heading: string; content: ReactNode }[] = [
  {
    heading: "tarkov.dev",
    content: (
      <>
        <p>
          Item, price, trader, quest, and map data comes from the free{" "}
          <External href="https://tarkov.dev/api/">tarkov.dev API</External> by{" "}
          <External href="https://github.com/the-hideout">The Hideout</External>. The raid planner&apos;s map
          setup is generated from tarkov.dev&apos;s{" "}
          <External href="https://github.com/the-hideout/tarkov-dev/blob/main/src/data/maps.json">maps.json</External>,
          and item images, map tiles, and map SVGs load from assets.tarkov.dev.
        </p>
        <p>
          It&apos;s a free service, so we try to be a good guest. Your browser asks our server for data instead of
          calling the tarkov.dev API, and our server keeps a copy of each dataset in memory. Each dataset is refreshed
          only as often as tarkov.dev changes it: prices every five minutes, maps and quests every half hour, and
          everything else every two hours. A refresh asks only whether the data changed, so an unchanged dataset
          isn&apos;t downloaded again. Only one refresh of a dataset runs at a time, and each server makes at most
          four requests to tarkov.dev at once, so busy periods on our site don&apos;t become extra requests. Small
          datasets that rarely change are shared between our servers, so a new server doesn&apos;t download them
          again. If tarkov.dev has trouble, we wait before trying again, longer after each failure or as long as it
          asks, and keep serving the copy we have. Every request names our site and how to reach us. Our responses
          are also cached by our CDN and in your browser, and our own API limits how often each visitor and all
          visitors together can call it.
        </p>
      </>
    ),
  },
  {
    heading: "Raid planner maps",
    content: (
      <>
        <p>
          The SVG maps of {mapNames((map) => map.strategy === "svg")} are by Shebuka, from{" "}
          <External href="https://github.com/the-hideout/tarkov-dev-svg-maps">tarkov-dev-svg-maps</External>, licensed{" "}
          <External href={CC_BY_NC_SA_4}>CC BY-NC-SA 4.0</External>. We don&apos;t edit the map artwork: the planner only controls
          which floors are visible, and your plan&apos;s markings are drawn on a separate layer on top.
        </p>
        <p>
          The other maps are image tiles from assets.tarkov.dev, credited on each map as tarkov.dev lists them: Shebuka
          ({mapNames((map) => map.strategy === "tile" && map.author === "Shebuka")}),{" "}
          <External href="https://tarkovbot.eu/">TarkovBOT.eu</External> (
          {mapNames((map) => map.author === "TarkovBOT.eu")}), and tarkov.dev (
          {mapNames((map) => map.author === "Tarkov.dev")}).
        </p>
      </>
    ),
  },
  {
    heading: "Escape from Tarkov Wiki",
    content: (
      <>
        <p>
          Text from the{" "}
          <External href="https://escapefromtarkov.fandom.com/wiki/Escape_from_Tarkov_Wiki">Escape from Tarkov Wiki</External>{" "}
          on Fandom is written by its contributors and licensed{" "}
          <External href="https://www.fandom.com/licensing">CC BY-NC-SA</External>, as the wiki states. We adapt it:
          the AI assistant tool <code>get_wiki_page</code> converts pages to plain text and shortens long ones, and
          our glossary&apos;s meanings are mostly written from wiki pages. Each wiki result and glossary entry links to the
          page it came from.
        </p>
        <p>
          <code>get_wiki_page</code> reads one page at a time through the wiki&apos;s MediaWiki API, names EFT Toolset
          in its requests, and keeps each page for an hour. It doesn&apos;t scrape the wiki&apos;s web pages. We plan
          to read the wiki from its published XML dump instead, so pages come from a copy rather than live requests.
        </p>
      </>
    ),
  },
  {
    heading: "Other glossary sources",
    content: (
      <p>
        A few glossary entries, mostly player slang, cite <External href="https://tarkovforge.com/">Tarkov Forge</External>,
        Reddit threads, or <External href="https://gamerant.com/">Game Rant</External>. Each entry links to its source.
      </p>
    ),
  },
  {
    heading: "Battlestate Games",
    content: (
      <p>
        Escape from Tarkov, its names, images, and game data belong to{" "}
        <External href="https://www.battlestategames.com/">Battlestate Games</External>. EFT Toolset is an unofficial
        fan site and isn&apos;t affiliated with or endorsed by them.
      </p>
    ),
  },
  {
    heading: "Software and fonts",
    content: (
      <p>
        Built with <External href="https://nextjs.org/">Next.js</External> and{" "}
        <External href="https://react.dev/">React</External> (MIT), <External href="https://leafletjs.com/">Leaflet</External>{" "}
        (BSD-2-Clause), <External href="https://www.radix-ui.com/">Radix UI</External> (MIT), and{" "}
        <External href="https://lucide.dev/">Lucide</External> icons (ISC), set in{" "}
        <External href="https://rsms.me/inter/">Inter</External> (SIL Open Font License). Our own code is{" "}
        <External href="https://github.com/M1NDLE55/eft-toolset">open source</External> under the GPL-3.0.
      </p>
    ),
  },
];

export default function Page() {
  return (
    <main className="flex flex-1 justify-center p-4 pb-12">
      <article className="flex w-full max-w-2xl flex-col gap-6">
        <h1 className="pt-6 text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Credits</h1>
        <p className="text-sm leading-relaxed text-[#bbb]">
          EFT Toolset is built on other people&apos;s work. These are the sources we use, their licences, and how we
          use them.
        </p>
        <ol className="flex flex-col gap-5">
          {sections.map((section, index) => (
            <li key={section.heading} className="flex flex-col gap-1.5">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
                {index + 1}. {section.heading}
              </h2>
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-[#bbb]">{section.content}</div>
            </li>
          ))}
        </ol>
      </article>
    </main>
  );
}
