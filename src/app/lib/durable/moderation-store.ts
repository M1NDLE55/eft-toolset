import { consumeTokens } from "@/app/lib/api/rate-limit-store";
import { DomainError, invalid, migrate, notFound, type Migration, type Sql } from "./sql";

/**
 * Reports from the "Report" button (§16.6), in one object (ModerationDO, named "moderation"):
 * one report per reporter per subject, a case per subject, and the admin's decisions. Three distinct
 * reporters within 7 days pause a public link until it is reviewed. Reporters are never shown to
 * owners, and owners are never shown to reporters.
 */
export const MODERATION_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_name TEXT NOT NULL,
        item TEXT,
        reason TEXT NOT NULL,
        detail TEXT,
        reporter TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (subject, reporter)
      )`,
      "CREATE INDEX reports_subject ON reports (subject, created_at)",
      `CREATE TABLE cases (
        subject TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        reporters INTEGER NOT NULL,
        target_kind TEXT NOT NULL,
        target_name TEXT NOT NULL,
        item TEXT,
        opened_at INTEGER NOT NULL,
        decided_at INTEGER,
        decision TEXT,
        cleared_at INTEGER
      )`,
      `CREATE TABLE buckets (name TEXT PRIMARY KEY, tokens REAL NOT NULL, updated_at INTEGER NOT NULL)`,
    ],
  },
];

export const REPORT_REASONS = ["offensive", "spam", "personal_info", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type Decision = "dismiss" | "disable_link" | "disable_target";

/** Distinct reporters on a public link, within the window, that pause it. A starting value. */
export const PAUSE_THRESHOLD = 3;
const PAUSE_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Reports are deleted this long after their case closes. */
const CLOSED_RETENTION_MS = 90 * 24 * 60 * 60_000;
/** Anonymous reporters, per hashed IP: 10 an hour, burst 5. */
const ANONYMOUS_RATE = { burst: 5, refillPerSecond: 10 / 3600 };

export interface ReportInput {
  subject: string;
  targetKind: "user" | "plan";
  targetName: string;
  item: string | null;
  reason: ReportReason;
  detail: string | null;
  /** "user:<id>" or "ip:<hmac>". */
  reporter: string;
}

export interface CaseRow {
  subject: string;
  status: "open" | "paused" | "dismissed" | "actioned";
  reporters: number;
  targetKind: "user" | "plan";
  targetName: string;
  item: string | null;
  openedAt: number;
  decidedAt: number | null;
  decision: Decision | null;
  reports: { reason: ReportReason; detail: string | null; createdAt: number }[];
}

export class ModerationStore {
  constructor(
    private readonly sql: Sql,
    private readonly transaction: (work: () => void) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  migrate() {
    return migrate(this.sql, MODERATION_MIGRATIONS, this.transaction);
  }

  /** The anonymous reporter's bucket; signed-in reporters are limited in their own UserDO. */
  chargeAnonymous(reporter: string) {
    const now = this.now();
    const row = this.sql.exec<{ tokens: number; updated_at: number }>("SELECT tokens, updated_at FROM buckets WHERE name = ?", reporter).toArray()[0];
    const bucket = row ? { tokens: row.tokens, updatedAt: row.updated_at } : { tokens: ANONYMOUS_RATE.burst, updatedAt: now };
    const result = consumeTokens(bucket, ANONYMOUS_RATE, now, 1, 0);
    this.sql.exec(
      "INSERT INTO buckets (name, tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at",
      reporter,
      bucket.tokens,
      bucket.updatedAt
    );
    if (!result.allowed) throw new DomainError("rate_limited", "Too many reports. Try again later.", { retryAfterSeconds: result.retryAfterSeconds });
  }

  /**
   * Stores a report and opens or updates the subject's case. Returns whether this report is the one
   * that pauses a public link, so the caller pauses it and tells the owner.
   */
  report(input: ReportInput): { duplicate: boolean; pause: boolean } {
    if (!REPORT_REASONS.includes(input.reason)) throw invalid("The reason is offensive, spam, personal_info or other.");
    const detail = input.detail ? input.detail.slice(0, 500) : null;
    let result = { duplicate: false, pause: false };
    this.transaction(() => {
      const now = this.now();
      const existing = this.sql.exec("SELECT 1 FROM reports WHERE subject = ? AND reporter = ?", input.subject, input.reporter).toArray().length > 0;
      if (existing) {
        result = { duplicate: true, pause: false };
        return;
      }
      this.sql.exec(
        "INSERT INTO reports (subject, target_kind, target_name, item, reason, detail, reporter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        input.subject,
        input.targetKind,
        input.targetName,
        input.item,
        input.reason,
        detail,
        input.reporter,
        now
      );
      const current = this.sql.exec<{ status: string; cleared_at: number | null }>("SELECT status, cleared_at FROM cases WHERE subject = ?", input.subject).toArray()[0];
      // Reports an admin already dismissed don't count toward pausing it again.
      const since = Math.max(now - PAUSE_WINDOW_MS, current?.cleared_at ?? 0);
      const recent = this.sql.exec<{ n: number }>("SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE subject = ? AND created_at > ?", input.subject, since).one().n;
      const total = this.sql.exec<{ n: number }>("SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE subject = ?", input.subject).one().n;
      if (!current || current.status === "dismissed" || current.status === "actioned") {
        this.sql.exec(
          `INSERT INTO cases (subject, status, reporters, target_kind, target_name, item, opened_at) VALUES (?, 'open', ?, ?, ?, ?, ?)
           ON CONFLICT(subject) DO UPDATE SET status = 'open', reporters = excluded.reporters, opened_at = excluded.opened_at, decided_at = NULL, decision = NULL`,
          input.subject,
          total,
          input.targetKind,
          input.targetName,
          input.item,
          now
        );
      } else {
        this.sql.exec("UPDATE cases SET reporters = ? WHERE subject = ?", total, input.subject);
      }
      const status = this.sql.exec<{ status: string }>("SELECT status FROM cases WHERE subject = ?", input.subject).one().status;
      if (input.subject.startsWith("link:") && status === "open" && recent >= PAUSE_THRESHOLD) {
        this.sql.exec("UPDATE cases SET status = 'paused' WHERE subject = ?", input.subject);
        result = { duplicate: false, pause: true };
      }
    });
    return result;
  }

  caseRow(subject: string): CaseRow | null {
    const row = this.sql
      .exec<{
        subject: string;
        status: CaseRow["status"];
        reporters: number;
        target_kind: "user" | "plan";
        target_name: string;
        item: string | null;
        opened_at: number;
        decided_at: number | null;
        decision: Decision | null;
      }>("SELECT * FROM cases WHERE subject = ?", subject)
      .toArray()[0];
    if (!row) return null;
    const reports = this.sql
      .exec<{ reason: ReportReason; detail: string | null; created_at: number }>("SELECT reason, detail, created_at FROM reports WHERE subject = ? ORDER BY created_at", subject)
      .toArray()
      .map((report) => ({ reason: report.reason, detail: report.detail, createdAt: report.created_at }));
    return {
      subject: row.subject,
      status: row.status,
      reporters: row.reporters,
      targetKind: row.target_kind,
      targetName: row.target_name,
      item: row.item,
      openedAt: row.opened_at,
      decidedAt: row.decided_at,
      decision: row.decision,
      reports,
    };
  }

  /** Open and paused cases, oldest first, for the admin queue. */
  queue(): CaseRow[] {
    return this.sql
      .exec<{ subject: string }>("SELECT subject FROM cases WHERE status IN ('open', 'paused') ORDER BY opened_at")
      .toArray()
      .map((row) => this.caseRow(row.subject)!);
  }

  /** Records the admin's decision; the caller applies it to the link or target. */
  decide(subject: string, decision: Decision): CaseRow {
    if (!["dismiss", "disable_link", "disable_target"].includes(decision)) throw invalid("The decision is dismiss, disable_link or disable_target.");
    const row = this.caseRow(subject);
    if (!row) throw notFound("No case for that subject.");
    if (decision === "disable_link" && !subject.startsWith("link:")) throw invalid("Only a link can be disabled on its own.");
    const now = this.now();
    this.sql.exec(
      "UPDATE cases SET status = ?, decision = ?, decided_at = ?, cleared_at = CASE WHEN ? = 'dismiss' THEN ? ELSE cleared_at END WHERE subject = ?",
      decision === "dismiss" ? "dismissed" : "actioned",
      decision,
      now,
      decision,
      now,
      subject
    );
    return this.caseRow(subject)!;
  }

  /** When an owner deletes their account, their cases close; reports go 90 days later. */
  closeCasesFor(targetKind: "user" | "plan", targetName: string) {
    this.sql.exec("UPDATE cases SET status = 'actioned', decision = COALESCE(decision, 'dismiss'), decided_at = ? WHERE target_kind = ? AND target_name = ? AND status IN ('open', 'paused')", this.now(), targetKind, targetName);
  }

  /** Deletes reports whose case closed more than 90 days ago. Returns when there is next work. */
  sweep(): number | null {
    const cutoff = this.now() - CLOSED_RETENTION_MS;
    this.transaction(() => {
      const closed = this.sql.exec<{ subject: string }>("SELECT subject FROM cases WHERE status IN ('dismissed', 'actioned') AND decided_at <= ?", cutoff).toArray();
      for (const { subject } of closed) {
        this.sql.exec("DELETE FROM reports WHERE subject = ?", subject);
        this.sql.exec("DELETE FROM cases WHERE subject = ?", subject);
      }
    });
    const next = this.sql.exec<{ t: number | null }>("SELECT MIN(decided_at) AS t FROM cases WHERE status IN ('dismissed', 'actioned')").one().t;
    return next === null ? null : next + CLOSED_RETENTION_MS;
  }
}
