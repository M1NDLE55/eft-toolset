"use client";

import Image from "next/image";
import Link from "next/link";
import type { BestBuild, BestBuildKind, WeaponBestBuilds } from "@/app/lib/builds/best-builds";
import { MODE_LABEL, useServerModeSync } from "@/components/game-mode/use-server-mode-sync";
import { Rubles } from "@/app/lib/currency";
import { cn } from "@/lib/utils";
import { BuildPartsSection } from "./build-parts";

const KIND_TITLE: Record<BestBuildKind, string> = {
  preset: "Factory preset",
  recoil: "Lowest recoil",
  ergonomics: "Max ergonomics",
};

const heading = "text-xs font-bold uppercase tracking-widest text-[#9a8866]";
const panel = "border border-[#1a1a1a] bg-[#0c0c0c]";

function number(value: number | null, digits = 0) {
  return value === null ? "—" : value.toFixed(digits).replace(/\.0+$/, "");
}

const STATS: { label: string; value: (build: BestBuild) => string; best?: "low" | "high"; read: (build: BestBuild) => number | null }[] = [
  { label: "Vertical recoil", value: (build) => number(build.recoilVertical), read: (build) => build.recoilVertical, best: "low" },
  { label: "Horizontal recoil", value: (build) => number(build.recoilHorizontal), read: (build) => build.recoilHorizontal, best: "low" },
  { label: "Ergonomics", value: (build) => number(build.ergonomics, 1), read: (build) => build.ergonomics, best: "high" },
  { label: "Weight", value: (build) => `${build.weight.toFixed(2)} kg`, read: (build) => build.weight },
  { label: "Cost", value: (build) => (build.costRUB === null ? "—" : Rubles.format(build.costRUB)), read: (build) => build.costRUB },
];

function BuildSection({ build, shortName }: { build: BestBuild; shortName: string }) {
  const id = `${build.kind}-build`;
  return (
    <BuildPartsSection
      id={id}
      title={build.kind === "preset" ? `${shortName} factory preset` : `${KIND_TITLE[build.kind]} ${shortName} build`}
      build={build}
    />
  );
}

export function BestBuildsView({ result }: { result: WeaponBestBuilds }) {
  const { switching, current } = useServerModeSync(result.gameMode);
  const { weapon, builds } = result;
  const extremes = new Map(
    STATS.filter((stat) => stat.best).map((stat) => {
      const values = builds.map(stat.read).filter((value): value is number => value !== null);
      return [stat.label, stat.best === "low" ? Math.min(...values) : Math.max(...values)];
    })
  );
  return (
    <div className={cn("flex flex-col gap-8 transition-opacity", switching && "opacity-50")} aria-busy={switching}>
      <header className="flex items-center gap-4">
        {weapon.gridImageLink && (
          <span className="flex h-16 w-28 shrink-0 items-center justify-center bg-[#0c0c0c]">
            <Image src={weapon.gridImageLink} alt="" width={112} height={64} className="max-h-16 w-auto object-contain" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Best {weapon.shortName} builds</h1>
          <p className="mt-1 text-sm text-[#888]">
            {weapon.name}
            {weapon.caliber && ` · ${weapon.caliber}`} · {weapon.weaponClass.replace(/s$/, "")}
          </p>
        </div>
      </header>

      <p className="text-sm text-[#999]">
        The lowest recoil and highest ergonomics {weapon.shortName} builds the gun builder&apos;s optimiser finds with parts
        you can buy from traders and the flea market, next to the factory preset.{" "}
        {switching ? `Loading ${MODE_LABEL[current]} prices…` : `Prices are live ${MODE_LABEL[result.gameMode]} prices.`}
      </p>

      <section aria-labelledby="compare-builds" className="flex flex-col gap-2">
        <h2 id="compare-builds" className={heading}>
          {weapon.shortName} build stats compared
        </h2>
        <div className="overflow-x-auto">
          <table className={cn(panel, "w-full text-xs sm:text-sm")}>
            <thead>
              <tr className="text-3xs uppercase tracking-widest text-[#777]">
                <th scope="col" className="px-2 py-2 text-left font-bold sm:px-3">Stat</th>
                {builds.map((build) => (
                  <th key={build.kind} scope="col" className="px-2 py-2 text-right font-bold sm:px-3">
                    <a href={`#${build.kind}-build`} className="hover:text-[#c8b384]">
                      {KIND_TITLE[build.kind]}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151515]">
              {STATS.map((stat) => (
                <tr key={stat.label}>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal text-[#999] sm:px-3">
                    {stat.label}
                  </th>
                  {builds.map((build) => (
                    <td
                      key={build.kind}
                      className={cn(
                        "px-2 py-1.5 text-right tabular-nums sm:px-3",
                        stat.best && stat.read(build) === extremes.get(stat.label) ? "text-emerald-400" : "text-[#ddd]"
                      )}
                    >
                      {stat.value(build)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {builds
        .filter((build) => build.kind !== "preset")
        .map((build) => (
          <BuildSection key={build.kind} build={build} shortName={weapon.shortName} />
        ))}
      {builds
        .filter((build) => build.kind === "preset")
        .map((build) => (
          <BuildSection key={build.kind} build={build} shortName={weapon.shortName} />
        ))}
    </div>
  );
}
