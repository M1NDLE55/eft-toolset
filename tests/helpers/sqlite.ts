import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlValue } from "@/app/lib/durable/sql";

/** A Durable Object's SQL API over Node's SQLite, as the stores use it. */
export function sqlite() {
  const db = new DatabaseSync(":memory:");
  const sql: Sql = {
    exec(query: string, ...bindings: SqlValue[]) {
      const statement = db.prepare(query);
      const rows = (statement.columns().length ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), [])) as never[];
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}.`);
          return rows[0];
        },
      };
    },
  };
  let depth = 0;
  const transaction = (work: () => void) => {
    // Durable Objects' transactionSync nests; SQLite needs savepoints for that.
    const name = `sp${depth}`;
    db.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
    depth += 1;
    try {
      work();
      depth -= 1;
      db.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
    } catch (error) {
      depth -= 1;
      db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw error;
    }
  };
  return { db, sql, transaction };
}

/** A controllable clock. */
export function testClock(start = 1_800_000_000_000) {
  let now = start;
  return {
    now: () => now,
    set: (value: number) => {
      now = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
