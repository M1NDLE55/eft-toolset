import { AccessError, LimitError } from "./sql";

/**
 * What a Durable Object method returns over RPC. Errors don't keep their class across RPC, so a
 * refused request comes back as a value the caller can branch on and show.
 */
export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: "limit"; code: LimitError["code"]; message: string } | { kind: "access"; message: string } };

export function outcome<T>(work: () => T): Outcome<T> {
  try {
    return { ok: true, value: work() };
  } catch (error) {
    if (error instanceof LimitError) return { ok: false, error: { kind: "limit", code: error.code, message: error.message } };
    if (error instanceof AccessError) return { ok: false, error: { kind: "access", message: error.message } };
    throw error;
  }
}

/** The value, or the refusal as an error with its message. */
export function unwrap<T>(result: Outcome<T>): T {
  if (result.ok) return result.value;
  throw result.error.kind === "limit" ? new LimitError(result.error.code, result.error.message) : new AccessError(result.error.message);
}
