import type { ErrorCode } from "@/app/lib/sharing/types";
import { DomainError } from "./sql";

/**
 * What a Durable Object method returns over RPC. Errors don't keep their class across RPC, so a
 * refused request comes back as a value the caller can branch on and show.
 */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export function outcome<T>(work: () => T): Outcome<T> {
  try {
    return { ok: true, value: work() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    throw error;
  }
}

export async function outcomeAsync<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    throw error;
  }
}

/** The value, or the refusal thrown again as a DomainError. */
export function unwrap<T>(result: Outcome<T>): T {
  if (result.ok) return result.value;
  throw new DomainError(result.error.code, result.error.message, result.error.details);
}
