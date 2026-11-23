// @vitest-environment node
// The optimiser benchmark: every weapon × the four setups in optimizer-compare.ts, run with this
// checkout's optimiser and with a baseline version from git, on the same tarkov.dev snapshot.
// It reports CPU time and judges every result against the baseline (equal, better or worse), and
// fails if any is worse. Opt in with `npm run bench:optimizer`. Settings (environment variables):
//   OPTIMIZER_BENCH_BASELINE  git revision of the baseline optimiser (default 50092747, master
//                             before the optimiser speed-up)
//   OPTIMIZER_BENCH_DATA      tarkov.dev snapshot directory (default data/tarkov, written by
//                             `node scripts/build-tarkov-snapshot.mjs` or `npm run build`)
//   OPTIMIZER_BENCH_ONLY      comma-separated filter on weapon names or ids
//   OPTIMIZER_BENCH_OUT       write every run's results to this JSON file
//   OPTIMIZER_BENCH_FIXTURE   write the regression test's fixture (see optimizer-regression.test.ts)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { expect, it, vi } from "vitest";
import { clearTarkovResourceCache } from "@/app/lib/api/tarkov-server";
import { setTarkovSnapshotDirForTests } from "@/app/lib/api/tarkov-snapshot";
import { optimizeBuild, type OptimizeOptions, type OptimizeResult } from "@/app/lib/builds/optimizer";
import { resolveBuild } from "@/app/lib/builds/resolve";
import type { BuildItemData, BuildNode, PresetContents } from "@/app/lib/types/gunBuilder";
import { defaultPreset, loadBuildPricing, purchaseContext } from "@/app/lib/mcp/build-prices";
import { CASES, MAX_GOAL_SCORE, caseOptions, judge, outcomeOf, penaltyTier, type CaseName, type Outcome, type Verdict } from "./optimizer-compare";

const enabled = Boolean(process.env.OPTIMIZER_BENCH);
const BASELINE = process.env.OPTIMIZER_BENCH_BASELINE || "50092747";
const DATA = resolve(process.env.OPTIMIZER_BENCH_DATA || "data/tarkov");
const ONLY = process.env.OPTIMIZER_BENCH_ONLY?.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean) ?? null;

type Optimize = (root: BuildNode, lookup: ReadonlyMap<string, BuildItemData>, options: OptimizeOptions) => Promise<OptimizeResult>;

/**
 * The baseline optimiser from git, with its relative imports pointed at this checkout's modules
 * (so only optimizer.ts differs) and its result given the objective it chose by.
 */
async function loadBaseline(): Promise<Optimize> {
  const source = execFileSync("git", ["show", `${BASELINE}:src/app/lib/builds/optimizer.ts`], { encoding: "utf8" });
  let patched = source.replace(/from "\.\/([^"]+)"/g, 'from "@/app/lib/builds/$1"');
  if (!patched.includes("objective: objective(chosen)")) {
    const anchor = "    evaluations,\n  };\n}";
    if (!patched.includes(anchor)) throw new Error(`Can't add the objective to ${BASELINE}'s optimiser result.`);
    patched = patched.replace(anchor, "    evaluations,\n    objective: objective(chosen),\n  };\n}");
  }
  // Outside node_modules, which vitest loads without transforming.
  const dir = mkdtempSync(join(tmpdir(), "optimizer-bench-"));
  const file = join(dir, `optimizer-${BASELINE.replace(/[^\w.-]/g, "_")}.ts`);
  writeFileSync(file, patched);
  const module = (await import(/* @vite-ignore */ file)) as { optimizeBuild: Optimize };
  return module.optimizeBuild;
}

/** Serves tarkov.dev's files from the snapshot, so both versions read exactly the same data. */
function serveSnapshot() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const [gameMode, resource] = url.pathname.split("/").filter(Boolean);
    try {
      return new Response(brotliDecompressSync(readFileSync(join(DATA, gameMode, `${resource}.json.br`))), { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
}

/** The run's result and the process CPU time it took (the runs are sequential). */
async function timed(work: () => Promise<OptimizeResult>) {
  const start = process.cpuUsage();
  const result = await work();
  const used = process.cpuUsage(start);
  return { result, cpuMs: (used.user + used.system) / 1000 };
}

interface Row {
  weapon: string;
  id: string;
  case: CaseName;
  baseline: Outcome & { cpuMs: number; evaluations: number };
  current: Outcome & { cpuMs: number; evaluations: number };
  verdict: Verdict;
  reason: string;
}

function percentile(values: number[], p: number) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)))];
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

it.skipIf(!enabled)("optimiser benchmark against the baseline", { timeout: 4 * 3_600_000 }, async () => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  setTarkovSnapshotDirForTests(DATA);
  clearTarkovResourceCache();
  serveSnapshot();
  const baseline = await loadBaseline();
  const read = <T,>(load: () => Promise<T> | T) => Promise.resolve(load());
  const pricing = await loadBuildPricing(read, "regular", { traders: true, flea: true });
  const { data, sources: priceSources } = pricing;
  const guns = data.guns.filter((gun) => !ONLY || ONLY.some((entry) => gun.id === entry || gun.name.toLowerCase().includes(entry)));
  const rows: Row[] = [];
  const fixtureCases: FixtureCase[] = [];

  for (const gun of guns) {
    const build = await resolveBuild(data, { weapon: gun.id, ...(gun.defaultPresetId ? { preset: "default" } : {}) });
    const bought = await purchaseContext(pricing, build.weaponId);
    for (const name of Object.keys(CASES) as CaseName[]) {
      const options = caseOptions(name, priceSources, bought, build.ammoId);
      // Alternate which version runs first, so neither always gets the warmer caches.
      const order = rows.length % 2 === 0 ? (["baseline", "current"] as const) : (["current", "baseline"] as const);
      const runs: Partial<Record<"baseline" | "current", { result: OptimizeResult; cpuMs: number }>> = {};
      for (const version of order) {
        const optimize = version === "baseline" ? baseline : optimizeBuild;
        runs[version] = await timed(() => optimize(build.root, data.lookup, options));
      }
      const before = { ...outcomeOf(runs.baseline!.result), cpuMs: runs.baseline!.cpuMs, evaluations: runs.baseline!.result.evaluations };
      const after = { ...outcomeOf(runs.current!.result), cpuMs: runs.current!.cpuMs, evaluations: runs.current!.result.evaluations };
      const { verdict, reason } = judge(before, after);
      rows.push({ weapon: gun.name, id: gun.id, case: name, baseline: before, current: after, verdict, reason });
      process.stderr.write(`${gun.name} ${name}: ${before.cpuMs.toFixed(0)} → ${after.cpuMs.toFixed(0)} ms, ${verdict}\n`);
      fixtureCases.push({
        weapon: gun.name,
        weaponId: gun.id,
        case: name,
        root: build.root,
        ammoId: build.ammoId,
        preset: await defaultPreset(data, build.weaponId),
        baseline: outcomeOf(runs.baseline!.result),
        current: outcomeOf(runs.current!.result),
        baselineCpuMs: before.cpuMs,
      });
    }
  }

  // The penalty tier is read from the score by rounding, which needs the goal's own score small.
  for (const row of rows) {
    for (const outcome of [row.baseline, row.current]) {
      expect(Math.abs(outcome.objective - penaltyTier(outcome.objective)), `${row.weapon} ${row.case}`).toBeLessThan(MAX_GOAL_SCORE);
    }
  }

  report(rows);
  if (process.env.OPTIMIZER_BENCH_OUT) writeFileSync(process.env.OPTIMIZER_BENCH_OUT, JSON.stringify(rows, null, 1));
  if (process.env.OPTIMIZER_BENCH_FIXTURE) writeFixture(process.env.OPTIMIZER_BENCH_FIXTURE, fixtureCases, data.lookup, priceSources);
  expect(rows.filter((row) => row.verdict === "worse").map((row) => `${row.weapon} ${row.case}: ${row.reason}`)).toEqual([]);
});

function report(rows: Row[]) {
  const lines: string[] = [];
  const table = (label: string, pick: (row: Row) => number) => {
    const values = rows.map(pick);
    return `${label.padEnd(9)} total ${(values.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s, median ${median(values).toFixed(1)} ms, p99 ${percentile(values, 99).toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`;
  };
  lines.push(`Runs: ${rows.length} (${new Set(rows.map((row) => row.id)).size} weapons × ${Object.keys(CASES).length} setups), baseline ${BASELINE}`);
  lines.push(table("baseline", (row) => row.baseline.cpuMs));
  lines.push(table("current", (row) => row.current.cpuMs));
  const m4 = rows.find((row) => row.id === "5447a9cd4bdc2dbd208b4567" && row.case === "heavy");
  if (m4) lines.push(`M4A1 heavy: ${m4.baseline.cpuMs.toFixed(0)} → ${m4.current.cpuMs.toFixed(0)} ms, evaluations ${m4.baseline.evaluations} → ${m4.current.evaluations}`);
  const evaluations = (pick: (row: Row) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  lines.push(`Evaluations: ${evaluations((row) => row.baseline.evaluations)} → ${evaluations((row) => row.current.evaluations)}`);
  lines.push(`Conflicted results: ${rows.filter((row) => row.baseline.conflicts > 0).length} → ${rows.filter((row) => row.current.conflicts > 0).length}`);
  const counts = { equal: 0, better: 0, worse: 0 };
  for (const row of rows) counts[row.verdict] += 1;
  lines.push(`Verdicts: ${counts.equal} equal, ${counts.better} better, ${counts.worse} worse`);
  for (const row of rows.filter((entry) => entry.verdict !== "equal")) {
    lines.push(
      `  ${row.verdict.toUpperCase().padEnd(6)} ${row.weapon} [${row.case}]: ${row.reason}; cost ${Math.round(row.baseline.costRUB)} → ${Math.round(row.current.costRUB)}, conflicts ${row.baseline.conflicts} → ${row.current.conflicts}, within budget ${row.baseline.withinBudget} → ${row.current.withinBudget}`
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

interface FixtureCase {
  weapon: string;
  weaponId: string;
  case: CaseName;
  root: BuildNode;
  ammoId: string | null;
  preset: PresetContents | null;
  baseline: Outcome;
  current: Outcome;
  baselineCpuMs: number;
}

// Weapons the regression test always keeps: results the warm start once got wrong (an emptied
// slot, a lower score) and a conflict case.
const KEEP_IN_FIXTURE = ["SR-3M", "AS VAL MOD.4", "AKMSN", "SCAR-H X-17"];

/**
 * The regression test's cases: the slowest baseline runs, the weapons above, results with
 * conflicts and results that changed, with every item those weapons can use.
 */
function writeFixture(path: string, cases: FixtureCase[], lookup: ReadonlyMap<string, BuildItemData>, priceSources: unknown) {
  const pick = new Map<string, FixtureCase>();
  const add = (entry: FixtureCase | undefined) => entry && pick.set(`${entry.weaponId}:${entry.case}`, entry);
  cases.toSorted((a, b) => b.baselineCpuMs - a.baselineCpuMs).slice(0, 4).forEach(add);
  for (const name of KEEP_IN_FIXTURE) add(cases.find((entry) => entry.case === "heavy" && entry.weapon.includes(name)));
  cases.filter((entry) => entry.baseline.conflicts > 0).slice(0, 4).forEach(add);
  cases.filter((entry) => entry.current.tree !== entry.baseline.tree).slice(0, 4).forEach(add);
  for (const name of ["ergonomics", "recoil", "cost"] as const) add(cases.find((entry) => entry.case === name && entry.weapon.includes("M4A1")));
  const chosen = [...pick.values()];
  const items = new Map<string, BuildItemData>();
  const visit = (id: string) => {
    const item = lookup.get(id);
    if (!item || items.has(id)) return;
    items.set(id, item);
    for (const slot of "slots" in item && Array.isArray(item.slots) ? item.slots : []) slot.allowedItemIds.forEach(visit);
  };
  for (const entry of chosen) visit(entry.weaponId);
  const fixture = {
    note: "Written by `npm run bench:optimizer` with OPTIMIZER_BENCH_FIXTURE; see tests/optimizer-regression.test.ts.",
    baselineRevision: BASELINE,
    priceSources,
    items: [...items.values()],
    cases: chosen.map(({ baselineCpuMs: _cpu, ...entry }) => entry),
  };
  const json = Buffer.from(JSON.stringify(fixture));
  writeFileSync(path, brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  process.stdout.write(`Fixture: ${chosen.length} cases, ${items.size} items, ${json.length} bytes (${readFileSync(path).length} compressed)\n`);
}
