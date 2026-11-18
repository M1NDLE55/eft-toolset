import { describe, expect, it } from "vitest";
import { findQuestDetail, zoneCounterpart } from "@/app/lib/quests/detail-lookup";
import type { GameMode } from "@/components/game-mode/mode";

/** A lookup over the slugs each mode has, recording what was asked for. */
function lookup(slugs: Record<GameMode, string[]>) {
  const asked: string[] = [];
  const get = async (gameMode: GameMode, slug: string) => {
    asked.push(`${gameMode}:${slug}`);
    return slugs[gameMode].includes(slug) ? `${gameMode}:${slug}` : null;
  };
  return { asked, get };
}

describe("finding a quest's detail", () => {
  it("pairs zone quest slugs across modes and nothing else", () => {
    expect(zoneCounterpart("capturing-outposts-pvp-zone")).toBe("capturing-outposts-pve-zone");
    expect(zoneCounterpart("capturing-outposts-pve-zone")).toBe("capturing-outposts-pvp-zone");
    expect(zoneCounterpart("debut")).toBeNull();
  });

  it("prefers the visitor's mode, then its copy of a zone quest, then the other mode", async () => {
    const both = lookup({ regular: ["debut"], pve: ["debut"] });
    expect(await findQuestDetail("pve", "debut", both.get)).toBe("pve:debut");
    expect(both.asked).toEqual(["pve:debut"]);

    const zone = lookup({ regular: ["outposts-pvp-zone"], pve: ["outposts-pve-zone"] });
    expect(await findQuestDetail("pve", "outposts-pvp-zone", zone.get)).toBe("pve:outposts-pve-zone");
    expect(zone.asked).toEqual(["pve:outposts-pvp-zone", "pve:outposts-pve-zone"]);

    const pvpOnly = lookup({ regular: ["new-beginning"], pve: [] });
    expect(await findQuestDetail("pve", "new-beginning", pvpOnly.get)).toBe("regular:new-beginning");
    expect(pvpOnly.asked).toEqual(["pve:new-beginning", "regular:new-beginning"]);

    const none = lookup({ regular: [], pve: [] });
    expect(await findQuestDetail("regular", "missing-pve-zone", none.get)).toBeNull();
    expect(none.asked).toEqual(["regular:missing-pve-zone", "regular:missing-pvp-zone", "pve:missing-pve-zone"]);
  });
});
