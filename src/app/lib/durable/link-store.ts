import { migrate, type Migration, type Sql } from "./sql";

export interface LinkRoute {
  targetKind: "user" | "plan";
  targetName: string;
  createdAt: number;
}

export const LINK_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE route (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        target_kind TEXT NOT NULL,
        target_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ],
  },
];

/** A link code's route: written once, never updated. */
export class LinkStore {
  constructor(
    private readonly sql: Sql,
    private readonly transaction: (work: () => void) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  migrate() {
    return migrate(this.sql, LINK_MIGRATIONS, this.transaction);
  }

  /** Writes the route; false if the code already routes somewhere (a 96-bit collision, or a replay). */
  init(route: Omit<LinkRoute, "createdAt">): boolean {
    const existing = this.resolve();
    if (existing) return existing.targetKind === route.targetKind && existing.targetName === route.targetName;
    this.sql.exec("INSERT INTO route (id, target_kind, target_name, created_at) VALUES (1, ?, ?, ?)", route.targetKind, route.targetName, this.now());
    return true;
  }

  resolve(): LinkRoute | null {
    const row = this.sql
      .exec<{ target_kind: "user" | "plan"; target_name: string; created_at: number }>("SELECT target_kind, target_name, created_at FROM route WHERE id = 1")
      .toArray()[0];
    return row ? { targetKind: row.target_kind, targetName: row.target_name, createdAt: row.created_at } : null;
  }
}
