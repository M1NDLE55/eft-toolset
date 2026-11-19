import Link from "next/link";
import type { Caliber } from "@/app/lib/seo/ammo";
import { Rubles } from "@/app/lib/currency";

const cell = "px-2 py-1.5 text-right tabular-nums";

/** One calibre's rounds, most penetration first, with stats and the cheapest price. */
export function AmmoTable({ caliber, headingLevel = 2 }: { caliber: Caliber; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const id = `caliber-${caliber.slug}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <Heading id={id} className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
        {headingLevel === 3 ? (
          <Link href={`/ammo/${caliber.slug}`} className="hover:text-[#c8b384] hover:underline underline-offset-2">
            {caliber.name} ammo
          </Link>
        ) : (
          `${caliber.name} ammo chart`
        )}
      </Heading>
      <div className="overflow-x-auto border border-[#1a1a1a] bg-[#0c0c0c]">
        <table className="w-full min-w-160 text-sm">
          <thead className="text-3xs uppercase tracking-widest text-[#666]">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-bold">Round</th>
              <th scope="col" className={`${cell} font-bold`} title="Penetration">Pen</th>
              <th scope="col" className={`${cell} font-bold`}>Damage</th>
              <th scope="col" className={`${cell} font-bold`} title="Armor damage">Armor dmg</th>
              <th scope="col" className={`${cell} font-bold`} title="Fragmentation chance">Frag</th>
              <th scope="col" className={`${cell} font-bold`}>Speed</th>
              <th scope="col" className={`${cell} font-bold`}>Recoil</th>
              <th scope="col" className="px-3 py-1.5 text-right font-bold">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {caliber.rounds.map((round) => (
              <tr key={round.name} className="hover:bg-[#100f0c]">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  {round.slug ? (
                    <Link href={`/item/${round.slug}`} className="text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
                      {round.name}
                    </Link>
                  ) : (
                    <span className="text-[#ccc]">{round.name}</span>
                  )}
                </th>
                <td className={`${cell} text-[#e6d9b8]`}>{round.penetration}</td>
                <td className={`${cell} text-[#ddd]`}>{round.projectiles > 1 ? `${round.projectiles}×${round.damage}` : round.damage}</td>
                <td className={`${cell} text-[#aaa]`}>{round.armorDamage}%</td>
                <td className={`${cell} text-[#aaa]`}>{round.fragmentation}%</td>
                <td className={`${cell} text-[#aaa]`}>{round.speed === null ? "—" : `${Math.round(round.speed)} m/s`}</td>
                <td className={`${cell} text-[#aaa]`}>{round.recoil === 0 ? "0" : `${round.recoil > 0 ? "+" : ""}${Math.round(round.recoil * 100)}%`}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className="block tabular-nums text-[#ddd]">{round.price === null ? "—" : Rubles.format(round.price)}</span>
                  <span className="block text-3xs text-[#777]">{round.source ?? "Loot only"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
