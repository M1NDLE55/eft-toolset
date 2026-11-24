import { DurableObject } from "cloudflare:workers";
import type { Sql } from "./sql";
import { LinkStore, type LinkRoute } from "./link-store";

/**
 * One per link code, named by the code (§6.3): an immutable route from the code to the object that
 * owns the link, a user (builds and item groups) or a plan. The link's state (revoked, expired,
 * uses) lives with its target, so revoking takes effect at once; this only says where to look.
 */
export class LinkDO extends DurableObject<Env> {
  private readonly store: LinkStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new LinkStore(ctx.storage.sql as unknown as Sql, (work) => ctx.storage.transactionSync(work));
    void ctx.blockConcurrencyWhile(async () => {
      this.store.migrate();
    });
  }

  init(route: Omit<LinkRoute, "createdAt">): boolean {
    return this.store.init(route);
  }

  resolve(): LinkRoute | null {
    return this.store.resolve();
  }

  /** Best effort, once the link is long dead: a leftover object only resolves to a 404 anyway. */
  async destroy() {
    await this.ctx.storage.deleteAll();
  }
}
