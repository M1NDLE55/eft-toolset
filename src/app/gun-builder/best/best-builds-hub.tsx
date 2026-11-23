import type { Metadata } from "@/app/lib/seo/metadata";
import Image from "@/app/lib/navigation/image";
import Link from "@/app/lib/navigation/link";
import { JsonLd, breadcrumbList } from "@/app/components/seo/json-ld";
import { WEAPON_CLASSES } from "@/app/lib/builds/weapon-classes";
import { BEST_BUILDS_HUB_DESCRIPTION, BEST_BUILDS_HUB_NAME, BEST_BUILDS_HUB_TITLE } from "@/app/lib/seo/builds";
import { SITE_ORIGIN } from "@/app/lib/site";
import type { BestBuildWeapon } from "@/app/lib/builds/best-builds";

export const BEST_BUILDS_HUB_METADATA: Metadata = {
  title: BEST_BUILDS_HUB_TITLE,
  description: BEST_BUILDS_HUB_DESCRIPTION,
  alternates: { canonical: "/gun-builder/best" },
  openGraph: {
    title: `${BEST_BUILDS_HUB_TITLE} | EFT Toolset`,
    description: BEST_BUILDS_HUB_DESCRIPTION,
    url: "/gun-builder/best",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
};

export function BestBuildsHub({ weapons }: { weapons: BestBuildWeapon[] }) {
  const groups = WEAPON_CLASSES.map((entry) => ({
    name: entry.name,
    weapons: weapons.filter((weapon) => weapon.weaponClass === entry.name).sort((a, b) => a.shortName.localeCompare(b.shortName)),
  })).filter((group) => group.weapons.length > 0);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: "Gun builder", path: "/gun-builder" },
          { name: BEST_BUILDS_HUB_NAME, path: "/gun-builder/best" },
        ])}
      />
      {weapons.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: BEST_BUILDS_HUB_NAME,
            itemListElement: weapons.map((weapon, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: `Best ${weapon.shortName} build`,
              url: `${SITE_ORIGIN}/gun-builder/best/${weapon.slug}`,
            })),
          }}
        />
      )}
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Best Tarkov weapon builds</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          The lowest recoil and highest ergonomics build for every Escape from Tarkov weapon, worked out by the{" "}
          <Link href="/gun-builder" className="text-[#c8b384] underline underline-offset-2">
            gun builder
          </Link>
          &apos;s optimiser from parts you can buy from traders and the flea market, with live prices. Pick a weapon to see
          every part, its stats next to the factory preset, and open the build to change it.
        </p>
      </header>
      {groups.length === 0 && (
        <p className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">
          The weapon list is temporarily unavailable. Try again in a moment.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.name} aria-labelledby={`class-${group.name}`} className="flex flex-col gap-3">
          <h2 id={`class-${group.name}`} className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            {group.name}
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.weapons.map((weapon) => (
              <li key={weapon.id}>
                <Link
                  href={`/gun-builder/best/${weapon.slug}`}
                  className="group flex items-center gap-3 border border-[#1a1a1a] bg-[#0c0c0c] p-2 transition-colors hover:border-[#9a8866]"
                >
                  <span className="flex h-10 w-16 shrink-0 items-center justify-center bg-[#080808]">
                    {weapon.gridImageLink && (
                      <Image src={weapon.gridImageLink} alt="" width={64} height={40} className="max-h-10 w-auto object-contain" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-[#ddd] group-hover:text-[#e6d9b8]">
                      Best {weapon.shortName} build
                    </span>
                    <span className="truncate text-xs text-[#777]">{weapon.caliber ?? weapon.name}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
