/**
 * The Workers Analytics Engine SQL API, read with an API token that has only the "Account Analytics
 * Read" permission: POST https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql
 * with the query as the body (https://developers.cloudflare.com/analytics/analytics-engine/sql-api/).
 * Every query here is built from code constants and checked numbers or dates, never from request
 * text, because the API takes no bind parameters.
 */

export type SqlRow = Record<string, string | number | null>;

export class StatsConfigError extends Error {}
export class StatsQueryError extends Error {}

const QUERY_TIMEOUT_MS = 10_000;

export interface SqlConfig {
  url: string;
  token: string;
}

/**
 * Where to send queries: the account's SQL API, or a stand-in on this machine (USAGE_SQL_API_URL,
 * honoured only for localhost, as scripts/usage-sql-mock.mjs uses in development). Null when the
 * account id or token isn't set.
 */
export function sqlConfig(env: NodeJS.ProcessEnv = process.env): SqlConfig | null {
  const token = env.STATS_CF_API_TOKEN?.trim() ?? "";
  const override = env.USAGE_SQL_API_URL?.trim() ?? "";
  if (override) {
    const url = new URL(override);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new StatsConfigError("USAGE_SQL_API_URL may only point at localhost.");
    }
    return { url: url.href, token: token || "local" };
  }
  const account = env.STATS_CF_ACCOUNT_ID?.trim() ?? "";
  if (!token || !/^[0-9a-f]{32}$/.test(account)) return null;
  return { url: `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, token };
}

/** Runs one query (FORMAT JSON) and returns its rows. */
export async function runSql(config: SqlConfig, query: string): Promise<SqlRow[]> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "text/plain" },
    body: `${query} FORMAT JSON`,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    // The API's error text says what was wrong with the query; it holds no secrets.
    throw new StatsQueryError(`Analytics Engine SQL API answered ${response.status}: ${text.slice(0, 300)}`);
  }
  const body = JSON.parse(text) as { data?: SqlRow[] };
  if (!Array.isArray(body.data)) throw new StatsQueryError("Analytics Engine SQL API returned no data.");
  return body.data;
}

export function num(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
