import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AmmoTable } from "@/app/components/reference/ammo-table";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { ServerModeNote } from "@/components/game-mode/server-mode-note";
import { readForRender } from "@/app/lib/api/server-render";
import type { GameMode } from "@/components/game-mode/mode";
import { listBestBuildWeapons } from "@/app/lib/builds/best-builds";
import { caliberDescription, caliberFaq, caliberTitle } from "@/app/lib/seo/ammo";
import { loadCalibers } from "../load";
import { FaqSection } from "@/app/components/seo/faq-section";

/** A calibre page for one game mode: /ammo/[caliber] renders PVP, and its PVE copy PVE. */
export interface PageProps {
  params: Promise<{ caliber: string }>;
}

class AmmoUnavailableError extends Error {
  constructor() {
    super("Ammo data is temporarily unavailable.");
    this.name = "AmmoUnavailableError";
  }
}

async function findCaliber(gameMode: GameMode, slug: string) {
  const loaded = await loadCalibers(gameMode);
  if (!loaded) return undefined;
  return { caliber: loaded.calibers.find((entry) => entry.slug === slug) ?? null, calibers: loaded.calibers };
}

export async function caliberMetadata({ params }: PageProps, gameMode: GameMode): Promise<Metadata> {
  const found = await findCaliber(gameMode, (await params).caliber);
  if (found && !found.caliber) return { title: "Calibre not found", robots: { index: false, follow: false } };
  if (!found?.caliber) return { title: "Ammo chart" };
  const title = caliberTitle(found.caliber);
  const description = caliberDescription(found.caliber);
  const url = `/ammo/${found.caliber.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${title} | EFT Toolset`, description, url, images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
  };
}

export async function CaliberPage({ params, gameMode }: PageProps & { gameMode: GameMode }) {
  const found = await findCaliber(gameMode, (await params).caliber);
  // Fail the render rather than cache a page without its rounds.
  if (found === undefined) throw new AmmoUnavailableError();
  const { caliber } = found;
  if (!caliber) notFound();
  const faq = caliberFaq(caliber);
  const weapons = ((await readForRender("Ammo weapons", () => listBestBuildWeapons("regular"))) ?? [])
    .filter((weapon) => weapon.caliber === caliber.name)
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
  return (
    <div className="flex w-full max-w-5xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: "Ammo chart", path: "/ammo" },
          { name: `${caliber.name} ammo`, path: `/ammo/${caliber.slug}` },
        ])}
      />
      <JsonLd data={faqPage(faq)} />
      <nav aria-label="Breadcrumb" className="-mb-4 text-2xs uppercase tracking-widest text-[#777]">
        <Link href="/ammo" className="hover:text-[#c8b384] hover:underline underline-offset-2">
          Ammo chart
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">{caliber.name} ammo</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          All {caliber.rounds.length} {caliber.name} rounds in Escape from Tarkov, highest penetration first, with
          damage, armor damage, fragmentation chance, speed, recoil and the cheapest place to buy each.{" "}
          <ServerModeNote rendered={gameMode} />
        </p>
      </header>
      <AmmoTable caliber={caliber} />
      <FaqSection id="caliber-faq" title={`${caliber.name} ammo questions`} entries={faq} />
      {weapons.length > 0 && (
        <nav aria-labelledby="caliber-weapons" className="flex flex-col gap-2">
          <h2 id="caliber-weapons" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            {caliber.name} weapon builds
          </h2>
          <ul className="flex flex-wrap gap-2">
            {weapons.map((weapon) => (
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
      )}
    </div>
  );
}
