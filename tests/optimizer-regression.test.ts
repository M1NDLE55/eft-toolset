// @vitest-environment node
// Replays a representative slice of the optimiser benchmark (tests/optimizer-benchmark.test.ts) on
// real tarkov.dev data: its slowest runs, the weapons the warm start once got wrong, and results
// with part conflicts. Each result must be no worse than the baseline optimiser's (master before
// the speed-up) and exactly what this optimiser gave when the fixture was written. To refresh the
// fixture after an intended change, run:
//   OPTIMIZER_BENCH_FIXTURE=tests/fixtures/optimizer-regression.json.br npm run bench:optimizer
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { optimizeBuild } from "@/app/lib/builds/optimizer";
import { presetParts } from "@/app/lib/builds/purchase";
import type { BuildItemData, BuildNode, PresetContents, PriceSources } from "@/app/lib/types/gunBuilder";
import { caseOptions, judge, outcomeOf, type CaseName, type Outcome } from "./optimizer-compare";

interface Fixture {
  baselineRevision: string;
  priceSources: PriceSources;
  items: BuildItemData[];
  cases: {
    weapon: string;
    weaponId: string;
    case: CaseName;
    root: BuildNode;
    ammoId: string | null;
    preset: PresetContents | null;
    baseline: Outcome;
    current: Outcome;
  }[];
}

const fixture = JSON.parse(
  brotliDecompressSync(readFileSync(join(import.meta.dirname, "fixtures/optimizer-regression.json.br"))).toString("utf8")
) as Fixture;
const lookup = new Map(fixture.items.map((item) => [item.id, item]));

describe(`optimiser results against ${fixture.baselineRevision}`, () => {
  it.each(fixture.cases.map((entry) => [`${entry.weapon} [${entry.case}]`, entry] as const))(
    "%s",
    { timeout: 60_000 },
    async (_label, entry) => {
      const preset = presetParts(entry.weaponId, entry.preset, lookup);
      const options = caseOptions(entry.case, fixture.priceSources, { limits: null, preset }, entry.ammoId);
      const outcome = outcomeOf(await optimizeBuild(entry.root, lookup, options, { pause: async () => undefined }));
      expect(judge(entry.baseline, outcome).verdict).not.toBe("worse");
      expect(outcome).toEqual(entry.current);
    }
  );
});
