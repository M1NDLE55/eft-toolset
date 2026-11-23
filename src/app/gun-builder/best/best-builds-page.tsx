import type { Metadata } from "@/app/lib/seo/metadata";
import Link from "@/app/lib/navigation/link";
import { BestBuildsView } from "@/app/components/gun-builder/best-builds-view";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import type { GameMode } from "@/components/game-mode/mode";
import { bestBuildFaq, BEST_BUILDS_HUB_NAME } from "@/app/lib/seo/builds";
import type { BestBuildWeapon, WeaponBestBuilds } from "@/app/lib/builds/best-builds";
import { caliberSlug } from "@/app/lib/seo/ammo";
import { FaqSection } from "@/app/components/seo/faq-section";

export interface BestBuildsPageData {
  gameMode: GameMode;
  slug: string;
  result: WeaponBestBuilds;
  /** Other weapons of the calibre, then of the class, for links. */
  sameCaliber: BestBuildWeapon[];
  sameClass: BestBuildWeapon[];
  metadata: Metadata;
}

export function BestBuildsPage({ data: { gameMode, slug, result, sameCaliber, sameClass } }: { data: BestBuildsPageData }) {
  const faq = bestBuildFaq(result);
  const url = `/gun-builder/best/${slug}`;
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: BEST_BUILDS_HUB_NAME, path: "/gun-builder/best" },
          { name: `Best ${result.weapon.shortName} build`, path: url },
        ])}
      />
      <JsonLd data={faqPage(faq)} />
      <nav aria-label="Breadcrumb" className="-mb-4 text-2xs uppercase tracking-widest text-[#777]">
        <Link href="/gun-builder/best" className="hover:text-[#c8b384] hover:underline underline-offset-2">
          {BEST_BUILDS_HUB_NAME}
        </Link>
      </nav>
      <BestBuildsView result={result} />
      {result.weapon.caliber && (
        <p className="-mt-4 text-sm text-[#999]">
          Choosing a round?{" "}
          <Link href={`/ammo/${caliberSlug(result.weapon.caliber)}`} className="text-[#c8b384] underline underline-offset-2">
            Compare every {result.weapon.caliber} round
          </Link>{" "}
          by penetration, damage and price.
        </p>
      )}
      <FaqSection id="build-faq" title={`${result.weapon.shortName} build questions`} entries={faq} />
      {[
        { title: `More ${result.weapon.caliber ?? ""} weapon builds`.replace("  ", " "), list: sameCaliber },
        { title: `More ${result.weapon.weaponClass.toLowerCase()}`, list: sameClass },
      ]
        .filter((group) => group.list.length > 0)
        .map((group) => (
          <nav key={group.title} aria-label={group.title} className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">{group.title}</h2>
            <ul className="flex flex-wrap gap-2">
              {group.list.map((weapon) => (
                <li key={weapon.id}>
                  <Link
                    href={`/gun-builder/best/${weapon.slug}`}
                    className="inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
                  >
                    Best {weapon.shortName} build
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
    </div>
  );
}
