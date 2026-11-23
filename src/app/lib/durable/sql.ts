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

/** A limit was reached; the message says what to do, and is safe to show the user. */
export class LimitError extends Error {
  constructor(
    readonly code: "owned_plans" | "shared_plans" | "builds" | "item_groups" | "plan_rate" | "plan_size" | "plan_content" | "entry_size",
    message: string
  ) {
    super(message);
    this.name = "LimitError";
  }
}

/** A request that names something that isn't there, or that the user may not touch. */
export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessError";
  }
}
