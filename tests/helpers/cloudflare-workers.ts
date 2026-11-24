/**
 * A stand-in for the `cloudflare:workers` module in tests, so the real Durable Object classes run
 * against a fake state (see durable-env.ts). Only what the classes use.
 */
export class DurableObject<E = unknown> {
  constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: E
  ) {}
}

export const env = {};
