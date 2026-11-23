import Link from "@/app/lib/navigation/link";
import { appLinks, guideLinks } from "@/app/lib/links";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

type FooterLink = { text: string; href: string };

const SITE_LINKS: FooterLink[] = [
  { text: "Settings", href: "/settings" },
  { text: "Account", href: "/settings#account" },
  { text: "Backup & restore", href: "/data" },
  { text: "AI assistants", href: "/mcp" },
  { text: "Credits", href: "/credits" },
  { text: "Disclaimer and use policy", href: "/policies/disclaimer-and-use-policy" },
];

const LIST = "flex flex-col gap-1.5 text-xs text-[#888]";

const SECTIONS: { title: string; links: FooterLink[]; className?: string; listClassName?: string }[] = [
  { title: "Tools", links: appLinks.map((link) => ({ text: link.title, href: link.href })) },
  { title: "Guides", links: guideLinks },
  {
    title: "Maps",
    links: mapConfigs.map((map) => ({ text: map.name, href: `/raid-planner/map/${map.key}` })),
    className: "col-span-2 md:col-span-1",
    listClassName: "grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-[#888] sm:grid-cols-3 md:grid-cols-2",
  },
  { title: "Site", links: SITE_LINKS },
];

const linkClass = "hover:text-[#ccc] focus-visible:outline-2 focus-visible:outline-[#9a8866]";

/** Site-wide footer: a quiet site map, so every page links to every tool, guide and map. */
export function SiteFooter() {
  return (
    <footer className="unscaled border-t border-[#1a1a1a] bg-[#070707] px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-[1fr_1fr_1.6fr_1fr]">
          {SECTIONS.map((section) => (
            <nav key={section.title} aria-label={section.title} className={section.className}>
              <h2 className="mb-3 text-3xs font-bold uppercase tracking-widest text-[#777]">{section.title}</h2>
              <ul className={section.listClassName ?? LIST}>
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClass}>
                      {link.text}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-col-reverse items-center gap-3 border-t border-[#141414] pt-4 text-3xs uppercase tracking-widest text-[#666] sm:flex-row sm:justify-between">
          <div className="flex flex-col-reverse items-center gap-2 sm:flex-row sm:gap-5">
            <p>&copy; {new Date().getFullYear()} EFT Toolset</p>
            <p>
              Maintained by{" "}
              <a href="https://github.com/M1NDLE55" rel="noopener noreferrer" className="text-[#9a8866] underline underline-offset-2">
                M1NDLE55
              </a>
            </p>
            <p>
              Data from{" "}
              <a href="https://tarkov.dev" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#ccc]">
                tarkov.dev
              </a>
            </p>
          </div>
          <a
            title="GitHub repository"
            aria-label="GitHub repository"
            href="https://github.com/M1NDLE55/eft-toolset"
            rel="noopener noreferrer"
            className="flex h-10 w-10 items-center justify-center text-[#9a8866] hover:text-[#e6d9b8]"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
              <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
