# Deployment

EFT Toolset runs as one Cloudflare Worker: a TanStack Start app built with the Cloudflare Vite
plugin. This page lists what the Cloudflare account needs, how to deploy, and the steps to move
www.eft-toolset.com from Vercel. DATA_ARCHITECTURE.md ("Platform") describes what each binding is for.

## What the account needs

- **Workers Paid plan.** It allows the CPU limit set in `wrangler.jsonc` (the optimiser and cold
  data loads need far more than the free plan's 10 ms), the static-asset file count (more than the
  free plan allows), and Durable Objects with SQLite storage.
- **CPU limit per invocation**: `limits.cpu_ms` is 40 seconds, for requests and cron runs alike. It
  equals the MCP tool deadline, so legitimate calls end at the app's own time limits with a clear
  error first; only runaway work reaches it, which Cloudflare stops with error 1102 ("Worker
  exceeded resource limits", outcome `exceededCpu` in the logs). It is a second guard beside the
  account's spending limits. Limits apply only when deployed, not in `wrangler dev`.
- **Workers KV**: one namespace for the binding `TARKOV_DATA`, created with
  `wrangler kv namespace create TARKOV_DATA`; its id is in `wrangler.jsonc`.
- **Durable Objects**: `USER` (class `UserDO`) and `PLAN` (class `PlanDO`), created by the `v1`
  migration, and `LINK` (class `LinkDO`) and `MODERATION` (class `ModerationDO`), created by the `v2`
  migration; all SQLite-backed, from `wrangler.jsonc` on deploy. UserDO and PlanDO also migrate their
  own SQL schemas to version 2 on first use (their version 1 tables were never written, apart from
  the MCP budget rows, which are kept). Nothing to set up by hand.
- **Rate limiting**: the bindings `MCP_IP_LIMITER` (namespace `1001`) and `WEB_IP_LIMITER`
  (namespace `1002`), 600 requests a minute each, and for sharing `SHARE_IP_LIMITER` (`1003`, 120 a
  minute), `INVITE_IP_LIMITER` (`1004`), `SOCKET_IP_LIMITER` (`1005`) and `LINK_IP_LIMITER` (`1006`),
  30 a minute each. They need no setup beyond the config.
- **Images**: the binding `IMAGES`, used to convert item icons for quest share images. It is billed
  per unique transformation; each icon is converted once per isolate and kept, so usage stays small.
  Check under Images in the dashboard that the account can use the Images binding. If a conversion
  fails, share images fall back to each icon's JPEG copy, so the site works without it.
- **Cron trigger**: `* * * * *`, from `wrangler.jsonc`; nothing to set up.
- **Workers Analytics Engine**: the binding `USAGE` writes to the dataset `eft_toolset_usage`, which
  Cloudflare creates on the first write; nothing to set up. Included in Workers Paid up to a monthly
  allowance of rows written and queries read, then billed per million (see USAGE_STATS.md).
- **Durable Object `USAGE_SALT`** (class `UsageSaltDO`), created by the `usage-v1` migration on the
  next deploy; one instance holds the usage-stats keys.
- **Observability**: Workers Logs are on (`observability.enabled`); the logs are the JSON lines the
  app writes (`mcp_tool_call`, `scheduled_refresh`, `tarkov_data_evicted`).

## Settings

Not secret, set in `wrangler.jsonc` under `vars` (prerendered pages are built with them, so they
belong in the config, not the dashboard). All are set to the production values:

| Variable | Value |
| --- | --- |
| `MCP_AUTHKIT_DOMAIN` | The production WorkOS AuthKit domain (`https://` is added). Empty keeps `/api/mcp` closed (503). |
| `MCP_RESOURCE_URL` | `https://www.eft-toolset.com/api/mcp` |
| `WORKOS_CLIENT_ID` | The production WorkOS client id |
| `CLOUDFLARE_WEB_ANALYTICS_TOKEN` | The Web Analytics site token (empty leaves the beacon out) |
| `APP_ORIGIN` | Not in the config: production uses `https://www.eft-toolset.com`. A deploy tested on the `workers.dev` hostname passes it on the command line (see Deploying) so sign-in returns there. |

Secrets, set with `wrangler secret put <name>` (never in the config):

| Secret | Value |
| --- | --- |
| `WORKOS_API_KEY` | The WorkOS API key, as set on Vercel today |
| `WORKOS_COOKIE_PASSWORD` | A 32+ character cookie password. The Worker's is new, not Vercel's, so everyone signed in on the website signs in again once after the cutover |
| `LINK_KEYS` | Signs share and invite link codes: `1:<random string of 32+ characters>`. To rotate, append `,2:<new secret>` and keep the old one while its links should work. Without it, making links answers 503 |
| `ADMIN_TOKEN` | Optional: 32+ characters, the bearer token for `/admin/reports` (the report queue). Without it the admin routes are off |
| `REPORT_WEBHOOK_URL` | Optional: a URL that gets a short alert (no content, no reporter) for each new report |

Usage stats (all optional; each part stays off until its secrets exist; see USAGE_STATS.md):

| Secret | Value |
| --- | --- |
| `STATS_ADMIN_USER_IDS` | WorkOS user ids (`user_…`) allowed to open `/admin/stats`, comma separated |
| `STATS_CF_ACCOUNT_ID` | The Cloudflare account id the dataset is in |
| `STATS_CF_API_TOKEN` | An API token with only **Account › Account Analytics › Read**, for this account |
| `STATS_READ_TOKEN` | A random string of 32+ characters for `GET /api/admin/stats/daily` (bearer token) |

They're secrets rather than `vars` so no ids or tokens sit in the repository.

`MCP_USER_RATE_BURST` and `MCP_USER_RATE_PER_SECOND` are optional (`vars`). Upstash, `CLIENT_IP_HEADER`,
`WARM_TARKOV_CACHE` and the Vercel variables are no longer used.

## WorkOS

Add, without removing anything Vercel uses until the cutover is done:

- Redirect URI `https://www.eft-toolset.com/auth/callback` (already there for Vercel; it stays).
- For the deploy tested before cutover: `https://<worker>.<subdomain>.workers.dev/auth/callback`,
  deployed with `APP_ORIGIN` set to that origin.
- For local development with sign-in: `http://localhost:3000/auth/callback` (already there).
- Sign-out redirect: the app returns to `<origin>/settings#account`, so
  `https://www.eft-toolset.com/settings` (already there), plus the same path on the `workers.dev`
  origin for the test deploy.

MCP sign-in is unchanged: AuthKit stays the authorization server, and tokens must still name
`https://www.eft-toolset.com/api/mcp` as their audience, so existing connectors (Claude, ChatGPT,
Cursor) keep working without reconnecting once DNS points at the Worker.

## Deploying

Deploy with `wrangler login`, or for CI with an API token made from the dashboard's **Edit
Cloudflare Workers** template (Workers scripts, KV, routes and account settings), scoped to this
account and the `eft-toolset.com` zone, with `CLOUDFLARE_ACCOUNT_ID` set.

```bash
npm ci
npm run build                 # tarkov.dev snapshot, client and server bundles, prerendered pages
npx wrangler deploy           # uses the config the build wrote (dist/server/wrangler.json)
```

Run `wrangler deploy` without `--config wrangler.jsonc`: the Vite plugin writes the deploy config
into the build output. To test sign-in on the `workers.dev` hostname before the cutover, deploy with
`npx wrangler deploy --var APP_ORIGIN:https://<worker>.<subdomain>.workers.dev`; the next plain
`wrangler deploy` drops it again, which is what production needs. The build needs network access to json.tarkov.dev for the snapshot (it never
fails the build without it). After the first deploy, trigger the cron once from the dashboard (or
wait a minute) so the price feed is in KV before traffic arrives; until then, reads use the items
file as before.

## Cutover from Vercel

DNS for eft-toolset.com is at the registrar today: the apex points at Vercel, which redirects it to
www with a 308; `www` is a CNAME to Vercel; and email forwarding uses the registrar's MX records and
an SPF TXT record. A Worker custom domain needs the zone on Cloudflare.

1. In Cloudflare, add the site `eft-toolset.com` (Free plan is enough for the zone). Compare the
   imported records with the registrar's DNS page, and check that every MX record (with its
   priority) and the SPF TXT record came across; add any that didn't. Leave the Vercel `A`/`CNAME` records as they are for now.
2. Deploy the Worker (above) and test it on its `workers.dev` hostname: `node scripts/parity.mjs
   --baseline https://www.eft-toolset.com --candidate https://<worker>.workers.dev --token <token>`
   compares pages and MCP tools with production (a token from your own MCP sign-in; production and
   the candidate read tarkov.dev minutes apart, so a few prices may differ).
3. At the registrar, change the nameservers to the two Cloudflare gives you. Wait until Cloudflare shows
   the zone as active.
4. Deploy once without `--var APP_ORIGIN` (a plain `npx wrangler deploy`), so sign-in returns to
   www.eft-toolset.com. Then, in the Worker's settings, add the custom domain `www.eft-toolset.com`.
   Cloudflare replaces the `www` CNAME with a record for the Worker and issues the certificate.
5. For the apex: replace Vercel's `A` record with a proxied `AAAA eft-toolset.com 100::`, and
   add a Single Redirect rule: requests to `eft-toolset.com/*` → `https://www.eft-toolset.com/${1}`,
   308, keeping the query string. (Vercel did the same redirect.)
6. Check: the home page, an item page, `/api/mcp` with your connector, `/sitemap.xml`, sign-in at
   `/settings`, and the Worker's logs (`scheduled_refresh` every minute).
7. When traffic has moved, remove the Vercel project's domains, then pause or delete the project.
   Remove the Upstash database if nothing else uses it.

## Rate limits at the edge

The Worker enforces the old Vercel firewall rule itself (600 requests a minute per IP on `/api/mcp`,
through `MCP_IP_LIMITER`), so no WAF rule is required. To refuse floods before the Worker runs (and
before they count as Worker requests), you can also add a WAF rate-limiting rule: URI path equals
`/api/mcp`, counting by IP, 600 requests a minute, action Block. The periods and number of rules
available depend on the zone's plan; on a plan with only a 10-second period, 100 requests per 10
seconds is the same rate.
