import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { getItemCatalog } from "@/app/lib/api/tarkov-server";
import { USAGE_DATASET } from "./catalog";
import { accountTotals } from "./accounts";
import { num, runSql, type SqlConfig, type SqlRow } from "./sql";

/**
 * The admin dashboard's and the daily summary's numbers, from the usage dataset. Counts are
 * SUM(_sample_interval), which stays right when Analytics Engine samples. Unique counts are
 * count(DISTINCT) of the anonymous ids: exact while nothing is sampled, a slight undercount if it
 * ever is (see USAGE_STATS.md). Column names follow USAGE_COLUMNS in catalog.ts.
 */

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

const T = USAGE_DATASET;
const COUNT = "SUM(_sample_interval)";
const ERRORS = "sumIf(_sample_interval, blob8 != '' AND blob8 != 'ok')";
const DAY = "toStartOfInterval(timestamp, INTERVAL '1' DAY)";

export interface Ranked {
  key: string;
  label: string;
  count: number;
  errors?: number;
}

export interface Distribution {
  signedIn: boolean;
  ids: number;
  p50: number;
  p90: number;
  max: number;
}

/** "2026-11-24 00:00:00" or an ISO string, as the SQL API returns DateTime, to YYYY-MM-DD. */
function dayOf(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

interface Names {
  item(id: string): string;
  map(key: string): string;
}

async function names(): Promise<Names> {
  const maps = new Map(mapConfigs.map((config) => [config.key, config.name]));
  let items = new Map<string, string>();
  try {
    items = new Map((await getItemCatalog("regular")).map(([id, name]) => [id, name]));
  } catch {
    // Ids stand in for names when the item index can't be read.
  }
  return { item: (id) => items.get(id) ?? id, map: (key) => maps.get(key) ?? key };
}

function ranked(rows: SqlRow[], key: string, label: (key: string) => string = (value) => value): Ranked[] {
  return rows.map((row) => {
    const value = String(row[key] ?? "");
    const entry: Ranked = { key: value, label: label(value), count: num(row.n) };
    if (row.errors !== undefined) entry.errors = num(row.errors);
    return entry;
  });
}

function subjects(rows: SqlRow[], lookup: Names, limit: number) {
  const byKind: Record<"weapon" | "item" | "map", Ranked[]> = { weapon: [], item: [], map: [] };
  for (const row of rows) {
    const kind = String(row.kind) as keyof typeof byKind;
    const id = String(row.id);
    if (!byKind[kind] || byKind[kind].length >= limit) continue;
    byKind[kind].push({ key: id, label: kind === "map" ? lookup.map(id) : lookup.item(id), count: num(row.n) });
  }
  return { weapons: byKind.weapon, items: byKind.item, maps: byKind.map };
}

function distributions(rows: SqlRow[]): Distribution[] {
  return rows.map((row) => ({
    signedIn: String(row.signed_in) === "1",
    ids: num(row.ids),
    p50: num(row.p50),
    p90: num(row.p90),
    max: num(row.max),
  }));
}

/** Actions per anonymous id per day (every event but page views), as quantiles across ids. */
function distributionQuery(where: string) {
  return `SELECT signed_in, count() AS ids, quantileExactWeighted(0.5)(n, w) AS p50, quantileExactWeighted(0.9)(n, w) AS p90, max(n) AS max FROM (SELECT blob12 AS id, blob14 AS signed_in, ${DAY} AS day, sumIf(_sample_interval, blob1 != 'page.view') AS n, 1 AS w FROM ${T} WHERE ${where} AND blob12 != '' GROUP BY id, signed_in, day) GROUP BY signed_in`;
}

export interface DashboardStats {
  range: DashboardRange;
  generatedAt: string;
  totals: { events: number; web: number; mcp: number; server: number };
  daily: { day: string; web: number; mcp: number; server: number }[];
  dailyActive: { day: string; visitors: number; accounts: number }[];
  weeklyActive: { week: string; visitors: number; accounts: number }[];
  actionsPerId: Distribution[];
  events: (Ranked & { feature: string })[];
  features: Ranked[];
  tools: Ranked[];
  weapons: Ranked[];
  items: Ranked[];
  maps: Ranked[];
  pages: Ranked[];
  pageErrors: Ranked[];
  countries: Ranked[];
  accounts: { total: number; capped: boolean; newByDay: { day: string; count: number }[] } | null;
}

export async function dashboardStats(config: SqlConfig, range: DashboardRange): Promise<DashboardStats> {
  const where = `timestamp > NOW() - INTERVAL '${range}' DAY`;
  const sql = (query: string) => runSql(config, query);
  const [bySourceDay, uniquesDay, uniquesWeek, perId, events, tools, subjectRows, pages, countries, lookup, accounts] =
    await Promise.all([
      sql(`SELECT ${DAY} AS day, blob2 AS source, ${COUNT} AS n FROM ${T} WHERE ${where} GROUP BY day, source ORDER BY day`),
      sql(`SELECT ${DAY} AS day, blob14 AS signed_in, count(DISTINCT blob12) AS ids FROM ${T} WHERE ${where} AND blob12 != '' GROUP BY day, signed_in ORDER BY day`),
      sql(`SELECT toStartOfWeek(timestamp) AS week, blob14 AS signed_in, count(DISTINCT blob13) AS ids FROM ${T} WHERE ${where} AND blob13 != '' GROUP BY week, signed_in ORDER BY week`),
      sql(distributionQuery(where)),
      sql(`SELECT blob1 AS event, blob3 AS feature, ${COUNT} AS n, ${ERRORS} AS errors FROM ${T} WHERE ${where} GROUP BY event, feature ORDER BY n DESC LIMIT 100`),
      sql(`SELECT blob4 AS tool, ${COUNT} AS n, ${ERRORS} AS errors FROM ${T} WHERE ${where} AND blob1 = 'mcp.tool_call' GROUP BY tool ORDER BY n DESC LIMIT 50`),
      sql(`SELECT blob5 AS kind, blob6 AS id, ${COUNT} AS n FROM ${T} WHERE ${where} AND blob6 != '' GROUP BY kind, id ORDER BY n DESC LIMIT 600`),
      sql(`SELECT blob1 AS event, blob15 AS route, ${COUNT} AS n FROM ${T} WHERE ${where} AND (blob1 = 'page.view' OR blob1 = 'page.error') GROUP BY event, route ORDER BY n DESC LIMIT 200`),
      sql(`SELECT blob10 AS country, ${COUNT} AS n FROM ${T} WHERE ${where} AND blob10 != '' GROUP BY country ORDER BY n DESC LIMIT 25`),
      names(),
      accountTotals(),
    ]);

  const daily = new Map<string, { day: string; web: number; mcp: number; server: number }>();
  const totals = { events: 0, web: 0, mcp: 0, server: 0 };
  for (const row of bySourceDay) {
    const day = dayOf(row.day);
    const entry = daily.get(day) ?? { day, web: 0, mcp: 0, server: 0 };
    const source = String(row.source) as "web" | "mcp" | "server";
    if (source in totals) {
      entry[source] += num(row.n);
      totals[source] += num(row.n);
      totals.events += num(row.n);
    }
    daily.set(day, entry);
  }

  // Features count actions; page views have their own list.
  const featureTotals = new Map<string, number>();
  for (const row of events) {
    if (row.event !== "page.view") featureTotals.set(String(row.feature), (featureTotals.get(String(row.feature)) ?? 0) + num(row.n));
  }

  return {
    range,
    generatedAt: new Date().toISOString(),
    totals,
    daily: [...daily.values()],
    dailyActive: activeSeries(uniquesDay, "day").map(({ period, visitors, accounts }) => ({ day: period, visitors, accounts })),
    weeklyActive: activeSeries(uniquesWeek, "week").map(({ period, visitors, accounts }) => ({ week: period, visitors, accounts })),
    actionsPerId: distributions(perId),
    events: events.map((row) => ({ ...ranked([row], "event")[0], feature: String(row.feature) })),
    features: [...featureTotals].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count),
    tools: ranked(tools, "tool"),
    ...subjects(subjectRows, lookup, 20),
    pages: ranked(pages.filter((row) => row.event === "page.view"), "route"),
    pageErrors: ranked(pages.filter((row) => row.event === "page.error"), "route"),
    countries: ranked(countries, "country"),
    accounts: accounts
      ? {
          total: accounts.total,
          capped: accounts.capped,
          newByDay: Object.entries(accounts.newByDay)
            .filter(([day]) => Date.parse(day) > Date.now() - range * 86_400_000)
            .map(([day, count]) => ({ day, count }))
            .sort((a, b) => a.day.localeCompare(b.day)),
        }
      : null,
  };
}

/** Rows of (period, signed_in, ids) as visitors (signed out) and accounts (signed in) per period. */
function activeSeries(rows: SqlRow[], key: string) {
  const series = new Map<string, { period: string; visitors: number; accounts: number }>();
  for (const row of rows) {
    const period = dayOf(row[key]);
    const entry = series.get(period) ?? { period, visitors: 0, accounts: 0 };
    if (String(row.signed_in) === "1") entry.accounts += num(row.ids);
    else entry.visitors += num(row.ids);
    series.set(period, entry);
  }
  return [...series.values()];
}

// ---- The daily summary ----

export interface SpikeCheck {
  value: number;
  /** The mean of the seven days before. */
  average7d: number;
  ratio: number | null;
  spike: boolean;
}

/** At least twice the week's average and at least SPIKE_MIN_INCREASE more, or SPIKE_MIN_INCREASE from nothing. */
const SPIKE_MIN_INCREASE = 20;

export function spikeCheck(value: number, previous: number[]): SpikeCheck {
  const average7d = previous.reduce((total, count) => total + count, 0) / 7;
  const ratio = average7d > 0 ? Math.round((value / average7d) * 100) / 100 : null;
  const spike = average7d > 0 ? value >= 2 * average7d && value - average7d >= SPIKE_MIN_INCREASE : value >= SPIKE_MIN_INCREASE;
  return { value, average7d: Math.round(average7d * 10) / 10, ratio, spike };
}

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD date that exists, isn't in the future and is within the dataset's three months; else null. */
export function summaryDate(value: string | null, now = Date.now()): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== value) return null;
  if (start > now || start < now - 90 * DAY_MS) return null;
  return value;
}

function isoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface DailySummary {
  date: string;
  generatedAt: string;
  visitors: { total: number; signedOut: number; signedIn: number };
  pageViews: number;
  activeAccounts: number;
  accounts: { new: number | null; total: number | null; capped: boolean };
  events: number;
  split: { web: number; mcp: number; server: number };
  topFeatures: Ranked[];
  topPages: Ranked[];
  topTools: Ranked[];
  topWeapons: Ranked[];
  topMaps: Ranked[];
  topItems: Ranked[];
  errors: { byTool: Ranked[]; byRoute: Ranked[]; total: number };
  spikes: Record<"visitors" | "pageViews" | "events" | "mcpCalls" | "errors", SpikeCheck>;
}

export async function dailySummary(config: SqlConfig, date: string): Promise<DailySummary> {
  const start = Date.parse(`${date}T00:00:00Z`);
  const literal = (ms: number) => `toDateTime('${isoDay(ms)} 00:00:00')`;
  // The day itself and the seven before it, for the spike checks.
  const week = `timestamp >= ${literal(start - 7 * DAY_MS)} AND timestamp < ${literal(start + DAY_MS)}`;
  const day = `timestamp >= ${literal(start)} AND timestamp < ${literal(start + DAY_MS)}`;
  const sql = (query: string) => runSql(config, query);
  const [perDay, uniques, tools, subjectRows, pages, lookup, accounts] = await Promise.all([
    sql(`SELECT ${DAY} AS day, blob1 AS event, blob2 AS source, blob3 AS feature, ${COUNT} AS n, ${ERRORS} AS errors FROM ${T} WHERE ${week} GROUP BY day, event, source, feature`),
    sql(`SELECT ${DAY} AS day, blob14 AS signed_in, count(DISTINCT blob12) AS ids FROM ${T} WHERE ${week} AND blob12 != '' GROUP BY day, signed_in`),
    sql(`SELECT blob4 AS tool, ${COUNT} AS n, ${ERRORS} AS errors FROM ${T} WHERE ${day} AND blob1 = 'mcp.tool_call' GROUP BY tool ORDER BY n DESC LIMIT 50`),
    sql(`SELECT blob5 AS kind, blob6 AS id, ${COUNT} AS n FROM ${T} WHERE ${day} AND blob6 != '' GROUP BY kind, id ORDER BY n DESC LIMIT 300`),
    sql(`SELECT blob1 AS event, blob15 AS route, ${COUNT} AS n FROM ${T} WHERE ${day} AND (blob1 = 'page.view' OR blob1 = 'page.error') GROUP BY event, route ORDER BY n DESC LIMIT 100`),
    names(),
    accountTotals(),
  ]);

  const days = Array.from({ length: 8 }, (_, index) => isoDay(start - (7 - index) * DAY_MS));
  const series = (pick: (row: SqlRow) => number) => {
    const byDay = new Map(days.map((entry) => [entry, 0]));
    for (const row of perDay) {
      const key = dayOf(row.day);
      if (byDay.has(key)) byDay.set(key, byDay.get(key)! + pick(row));
    }
    return days.map((entry) => byDay.get(entry)!);
  };
  const events = series((row) => num(row.n));
  const pageViews = series((row) => (row.event === "page.view" ? num(row.n) : 0));
  const mcpCalls = series((row) => (row.event === "mcp.tool_call" ? num(row.n) : 0));
  const errors = series((row) => num(row.errors) + (row.event === "page.error" ? num(row.n) : 0));
  const visitorsSeries = days.map((entry) =>
    uniques.filter((row) => dayOf(row.day) === entry).reduce((total, row) => total + num(row.ids), 0)
  );
  const todayUniques = uniques.filter((row) => dayOf(row.day) === date);
  const signedIn = todayUniques.filter((row) => String(row.signed_in) === "1").reduce((total, row) => total + num(row.ids), 0);
  const signedOut = todayUniques.filter((row) => String(row.signed_in) !== "1").reduce((total, row) => total + num(row.ids), 0);

  const split = { web: 0, mcp: 0, server: 0 };
  const features = new Map<string, number>();
  for (const row of perDay) {
    if (dayOf(row.day) !== date) continue;
    const source = String(row.source) as keyof typeof split;
    if (source in split) split[source] += num(row.n);
    if (row.event !== "page.view") features.set(String(row.feature), (features.get(String(row.feature)) ?? 0) + num(row.n));
  }
  const top = subjects(subjectRows, lookup, 10);
  const check = (values: number[]) => spikeCheck(values[7], values.slice(0, 7));
  const toolRows = ranked(tools, "tool");

  return {
    date,
    generatedAt: new Date().toISOString(),
    visitors: { total: signedIn + signedOut, signedOut, signedIn },
    pageViews: pageViews[7],
    activeAccounts: signedIn,
    accounts: {
      new: accounts ? (accounts.newByDay[date] ?? 0) : null,
      total: accounts ? accounts.total : null,
      capped: accounts?.capped ?? false,
    },
    events: events[7],
    split,
    topFeatures: [...features].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    topPages: ranked(pages.filter((row) => row.event === "page.view"), "route").slice(0, 10),
    topTools: toolRows.slice(0, 10),
    topWeapons: top.weapons,
    topMaps: top.maps,
    topItems: top.items,
    errors: {
      byTool: toolRows.filter((row) => (row.errors ?? 0) > 0).map(({ key, label, errors }) => ({ key, label, count: errors ?? 0 })),
      byRoute: ranked(pages.filter((row) => row.event === "page.error"), "route"),
      total: errors[7],
    },
    spikes: {
      visitors: check(visitorsSeries),
      pageViews: check(pageViews),
      events: check(events),
      mcpCalls: check(mcpCalls),
      errors: check(errors),
    },
  };
}
