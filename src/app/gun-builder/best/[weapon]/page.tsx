import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BestBuildsView } from "@/app/components/gun-builder/best-builds-view";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { isCrawlerRequest } from "@/app/lib/api/server-render";
import { bestBuildDescription, bestBuildFaq, bestBuildTitle, BEST_BUILDS_HUB_NAME } from "@/app/lib/seo/builds";
import { isItemSlug } from "@/app/lib/item-links";
import { loadBestBuildWeapons, loadWeaponBestBuilds } from "../load";
import { caliberSlug } from "@/app/lib/seo/ammo";
import { FaqSection } from "@/app/components/seo/faq-section";

interface PageProps {
  params: Promise<{ weapon: string }>;
}

/** Thrown for a crawler when the builds couldn't be worked out in time, so it retries later. */
class BestBuildsUnavailableError extends Error {
  constructor() {
    super("Best builds are temporarily unavailable.");
    this.name = "BestBuildsUnavailableError";
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = (await params).weapon;
  if (!isItemSlug(slug)) return { title: "Weapon not found", robots: { index: false, follow: false } };
  const result = await loadWeaponBestBuilds(slug);
  if (result === null) return { title: "Weapon not found", robots: { index: false, follow: false } };
  if (!result) return { title: "Best weapon builds" };
  const title = bestBuildTitle(result.weapon);
  const description = bestBuildDescription(result);
  const url = `/gun-builder/best/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} | EFT Toolset`,
      description,
      url,
      type: "article",
      images: result.weapon.gridImageLink ? [{ url: result.weapon.gridImageLink }] : [{ url: "/home-og-image.png", width: 1200, height: 630 }],
    },
    twitter: { card: "summary", title: `${title} | EFT Toolset`, description },
  };
}

export default async function Page({ params }: PageProps) {
  const slug = (await params).weapon;
  if (!isItemSlug(slug)) notFound();
  const result = await loadWeaponBestBuilds(slug);
  if (result === null) notFound();
  if (result === undefined) {
    if (await isCrawlerRequest()) throw new BestBuildsUnavailableError();
    return (
      <div className="flex w-full max-w-3xl flex-col items-center gap-3 border border-dashed border-[#2a2a2a] p-8 text-center">
        <h1 className="font-semibold text-[#ccc]">These builds are being worked out</h1>
        <p className="text-sm text-[#888]">The optimiser is busy. Reload in a few seconds, or build it yourself.</p>
        <Link href="/gun-builder" className="text-sm text-[#c8b384] underline underline-offset-2">
          Open the gun builder
        </Link>
      </div>
    );
  }
  const faq = bestBuildFaq(result);
  const weapons = (await loadBestBuildWeapons()) ?? [];
  const sameCaliber = weapons
    .filter((weapon) => weapon.caliber && weapon.caliber === result.weapon.caliber && weapon.slug !== slug)
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
  const sameClass = weapons
    .filter((weapon) => weapon.weaponClass === result.weapon.weaponClass && weapon.slug !== slug && !sameCaliber.includes(weapon))
    .sort((a, b) => a.shortName.localeCompare(b.shortName))
    .slice(0, 24);
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
      <nav aria-label="Breadcrumb" className="-mb-4 text-[11px] uppercase tracking-widest text-[#777]">
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
