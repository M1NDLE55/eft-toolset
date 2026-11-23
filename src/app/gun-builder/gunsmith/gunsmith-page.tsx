import type { Metadata } from "@/app/lib/seo/metadata";
import Image from "@/app/lib/navigation/image";
import Link from "@/app/lib/navigation/link";
import { Check, CircleHelp, X } from "lucide-react";
import { BuildPartsSection } from "@/app/components/gun-builder/build-parts";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { ServerModeNote } from "@/components/game-mode/server-mode-note";
import type { GameMode } from "@/components/game-mode/mode";
import { Rubles } from "@/app/lib/currency";
import type { GunsmithObjectiveView, GunsmithTaskSummary, GunsmithTaskView } from "@/app/lib/builds/gunsmith-pages";
import {
  GUNSMITH_HUB_NAME,
  UNCHECKED_HINTS,
  formatRequirement,
  gunsmithFaq,
} from "@/app/lib/seo/gunsmith";
import { FaqSection } from "@/app/components/seo/faq-section";

export interface GunsmithPageData {
  gameMode: GameMode;
  slug: string;
  view: GunsmithTaskView;
  /** The tasks before and after it in the list. */
  neighbours: GunsmithTaskSummary[];
  metadata: Metadata;
}

const heading = "text-xs font-bold uppercase tracking-widest text-[#9a8866]";
const panel = "border border-[#1a1a1a] bg-[#0c0c0c]";

function Status({ status }: { status: "pass" | "fail" | "unknown" }) {
  if (status === "pass") return <Check aria-label="Meets it" className="ml-auto h-4 w-4 text-emerald-400" />;
  if (status === "fail") return <X aria-label="Doesn't meet it" className="ml-auto h-4 w-4 text-red-400" />;
  return <CircleHelp aria-label="Check in game" className="ml-auto h-4 w-4 text-amber-300" />;
}

function Objective({ objective, taskName, several }: { objective: GunsmithObjectiveView; taskName: string; several: boolean }) {
  const { weapon, build } = objective;
  const anchor = several ? `-${weapon.id}` : "";
  return (
    <div className="flex flex-col gap-6">
      {several && (
        <h2 className="flex items-center gap-3 text-lg font-black uppercase tracking-widest text-[#e6d9b8]">
          {weapon.gridImageLink && <Image src={weapon.gridImageLink} alt="" width={80} height={40} className="h-10 w-auto" />}
          {weapon.shortName}
        </h2>
      )}
      <section aria-labelledby={`requirements${anchor}`} className="flex flex-col gap-2">
        <h2 id={`requirements${anchor}`} className={heading}>
          {weapon.shortName} requirements
        </h2>
        <table className={`${panel} w-full text-sm`}>
          <thead className="text-left text-3xs uppercase tracking-widest text-[#666]">
            <tr>
              <th scope="col" className="px-3 py-1.5 font-bold">Requirement</th>
              <th scope="col" className="px-3 py-1.5 font-bold">Needs</th>
              <th scope="col" className="px-3 py-1.5 text-right font-bold">{build ? "This build" : "Closest"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            <tr>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-[#ccc]">Weapon</th>
              <td className="px-3 py-1.5" colSpan={2}>
                {weapon.slug ? (
                  <Link href={`/item/${weapon.slug}`} className="text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                    {weapon.name}
                  </Link>
                ) : (
                  weapon.name
                )}
              </td>
            </tr>
            {objective.checks.map((check) => (
              <tr key={check.name}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-[#ccc]">
                  {check.label}
                  {check.status === "unknown" && UNCHECKED_HINTS[check.name] && (
                    <span className="block text-2xs text-[#888]">{UNCHECKED_HINTS[check.name]}</span>
                  )}
                </th>
                <td className="px-3 py-1.5 text-[#999]">{formatRequirement(check)}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center justify-end gap-2 tabular-nums text-[#ddd]">
                    {check.actual === null ? "—" : `${check.actual}${check.unit}`}
                    <Status status={check.status} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(objective.requiredParts.length > 0 || objective.requiredCategories.length > 0) && (
          <div className={`${panel} flex flex-col gap-1 px-3 py-2 text-sm`}>
            <span className="text-3xs font-bold uppercase tracking-widest text-[#666]">Must include</span>
            <ul className="flex flex-col gap-0.5">
              {objective.requiredParts.map((part) => (
                <li key={part.name}>
                  {part.slug ? (
                    <Link href={`/item/${part.slug}`} className="text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                      {part.name}
                    </Link>
                  ) : (
                    <span className="text-[#ccc]">{part.name}</span>
                  )}
                </li>
              ))}
              {objective.requiredCategories.map((category) => (
                <li key={category} className="text-[#ccc]">
                  Any {category.toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {build ? (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Ergonomics", build.ergonomics === null ? "—" : String(Math.round(build.ergonomics * 10) / 10)],
              [
                "Recoil sum",
                build.recoilVertical === null || build.recoilHorizontal === null ? "—" : String(Math.round(build.recoilVertical + build.recoilHorizontal)),
              ],
              ["Weight", `${build.weight.toFixed(2)} kg`],
              ["Cost", build.costRUB === null ? "—" : Rubles.format(build.costRUB)],
            ].map(([label, value]) => (
              <div key={label} className={`${panel} flex flex-col gap-0.5 p-3`}>
                <dt className="text-3xs font-bold uppercase tracking-widest text-[#777]">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-[#e6d9b8]">{value}</dd>
              </div>
            ))}
          </dl>
          <BuildPartsSection id={`build${anchor}`} title={`${weapon.shortName} build for ${taskName}`} build={build} />
        </>
      ) : (
        <section className={`${panel} flex flex-col gap-2 p-4 text-sm`}>
          <h2 className="font-semibold text-[#ddd]">No ready build yet</h2>
          <p className="text-[#999]">
            We couldn&apos;t find a build from traders and the flea market that meets every requirement automatically
            {objective.missingParts.length > 0 && `: the closest attempt still lacks ${objective.missingParts.join(", ")}`}
            {objective.missingCategories.length > 0 && `${objective.missingParts.length ? " and" : ":"} any ${objective.missingCategories.join(", ").toLowerCase()}`}
            . The table above shows the closest attempt. Start from the weapon with the required parts installed and finish
            it in the gun builder.
          </p>
          <a href={objective.start.shareHref} className="w-fit text-2xs font-bold uppercase tracking-widest text-[#c8b384] underline-offset-2 hover:underline">
            Start this build in the gun builder
          </a>
        </section>
      )}
    </div>
  );
}

export function GunsmithPage({ data: { gameMode, slug, view, neighbours } }: { data: GunsmithPageData }) {
  const { task } = view;
  const faq = gunsmithFaq(view);
  const several = view.objectives.length > 1;
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: GUNSMITH_HUB_NAME, path: "/gun-builder/gunsmith" },
          { name: task.name, path: `/gun-builder/gunsmith/${slug}` },
        ])}
      />
      {faq.length > 0 && <JsonLd data={faqPage(faq)} />}
      <nav aria-label="Breadcrumb" className="-mb-4 text-2xs uppercase tracking-widest text-[#777]">
        <Link href="/gun-builder/gunsmith" className="hover:text-[#c8b384] hover:underline underline-offset-2">
          {GUNSMITH_HUB_NAME}
        </Link>
      </nav>
      <header className="flex items-center gap-4">
        {!several && view.objectives[0]?.weapon.gridImageLink && (
          <span className="flex h-16 w-28 shrink-0 items-center justify-center bg-[#0c0c0c]">
            <Image src={view.objectives[0].weapon.gridImageLink} alt="" width={112} height={64} className="max-h-16 w-auto object-contain" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">{task.name} build</h1>
          <p className="mt-1 text-sm text-[#888]">
            {[task.trader, task.minPlayerLevel > 0 ? `level ${task.minPlayerLevel}` : null, task.faction ? `${task.faction} only` : null]
              .filter(Boolean)
              .join(" · ")}
            {task.wikiLink && (
              <>
                {" · "}
                <a href={task.wikiLink} rel="noopener noreferrer" className="text-[#c8b384] underline-offset-2 hover:underline">
                  Wiki
                </a>
              </>
            )}
          </p>
        </div>
      </header>
      <p className="text-sm text-[#999]">
        {task.name} asks for {view.objectives.map((objective) => `a ${objective.weapon.name}`).join(" and ")} built to the
        requirements below. Each build is worked out by the gun builder from parts sold by traders and on the flea market,
        then checked against every requirement the data covers. <ServerModeNote rendered={view.gameMode} />
      </p>
      {view.objectives.map((objective) => (
        <Objective key={objective.weapon.id} objective={objective} taskName={task.name} several={several} />
      ))}
      {faq.length > 0 && (
        <FaqSection id="gunsmith-faq" title={`${task.name} questions`} entries={faq} />
      )}
      {neighbours.length > 0 && (
        <nav aria-label="More Gunsmith builds" className="flex flex-col gap-2">
          <h2 className={heading}>More Gunsmith builds</h2>
          <ul className="flex flex-wrap gap-2">
            {neighbours.map((entry) => (
              <li key={entry!.slug}>
                <Link
                  href={`/gun-builder/gunsmith/${entry!.slug}`}
                  className="inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
                >
                  {entry!.name}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/gun-builder/gunsmith"
                className="inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]"
              >
                All Gunsmith builds
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
