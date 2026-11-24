import type { ErrorCode } from "@/app/lib/sharing/types";

/**
 * The part of a Durable Object's SQLite API (ctx.storage.sql) the stores use, so they can run
 * against Node's built-in SQLite in tests.
 */
export type SqlValue = string | number | null | ArrayBuffer;
export type SqlRow = Record<string, SqlValue>;

export interface SqlCursor<T extends SqlRow = SqlRow> {
  toArray(): T[];
  one(): T;
}

export interface Sql {
  exec<T extends SqlRow = SqlRow>(query: string, ...bindings: SqlValue[]): SqlCursor<T>;
}

/** One schema change; versions start at 1 and never change once shipped. */
export interface Migration {
  version: number;
  statements: readonly string[];
}

/**
 * Brings the schema up to the newest migration. Durable Objects run this in blockConcurrencyWhile,
 * so no request sees a half-migrated schema; each migration and its version bump apply together.
 */
export function migrate(sql: Sql, migrations: readonly Migration[], transaction: (work: () => void) => void) {
  sql.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = sql.exec<{ value: string }>("SELECT value FROM schema_meta WHERE key = 'version'").toArray()[0];
  let version = row ? Number(row.value) : 0;
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= version) continue;
    transaction(() => {
      for (const statement of migration.statements) sql.exec(statement);
      sql.exec("INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(migration.version));
    });
    version = migration.version;
  }
  return version;
}

/**
 * A refused request: the code says why (the sharing routes' error codes), the message is safe to
 * show the user, and details carry what a client can act on (the limit and usage, the current
 * version). Durable Objects return it as a value over RPC (see outcome.ts), since errors don't keep
 * their class across RPC.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const limitError = (message: string, details?: Record<string, unknown>) => new DomainError("limit", message, details);
export const notFound = (message = "That doesn't exist, or isn't shared with you.") => new DomainError("not_found", message);
export const forbidden = (message: string) => new DomainError("forbidden", message);
export const invalid = (message: string, details?: Record<string, unknown>) => new DomainError("invalid", message, details);
