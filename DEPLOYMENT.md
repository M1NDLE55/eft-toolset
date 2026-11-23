# Deployment

EFT Toolset runs as one Cloudflare Worker: a TanStack Start app built with the Cloudflare Vite
plugin. This page lists what the Cloudflare account needs, how to deploy, and the steps to move
www.eft-toolset.com from Vercel. DATA_ARCHITECTURE.md ("Platform") describes what each binding is for.

## What the account needs

- **Workers Paid plan.** It covers the 60-second CPU limit set in `wrangler.jsonc` (`limits.cpu_ms`;
  the optimiser and cold data loads need more than the free plan's 10 ms), the static-asset file
  count (more than the free plan allows), and Durable Objects with SQLite storage.
- **Workers KV**: one namespace for the binding `TARKOV_DATA`. Wrangler creates it on the first
  deploy (the binding has no `id`); after that, add the id it prints to `wrangler.jsonc` so later
  deploys don't depend on provisioning.
- **Durable Objects**: `USER` (class `UserDO`) and `PLAN` (class `PlanDO`), SQLite-backed, created by
  the `v1` migration in `wrangler.jsonc` on the first deploy. Nothing to set up by hand.
- **Rate limiting**: the bindings `MCP_IP_LIMITER` (namespace `1001`) and `WEB_IP_LIMITER`
  (namespace `1002`), 600 requests a minute each. They need no setup beyond the config.
- **Images**: the binding `IMAGES`, used to convert item icons for quest share images. It is billed
  per unique transformation; each icon is converted once per isolate and kept, so usage stays small.
  Check under Images in the dashboard that the account can use the Images binding. If a conversion
  fails, share images fall back to each icon's JPEG copy, so the site works without it.
- **Cron trigger**: `* * * * *`, from `wrangler.jsonc`; nothing to set up.
- **Observability**: Workers Logs are on (`observability.enabled`); the logs are the JSON lines the
  app writes (`mcp_tool_call`, `scheduled_refresh`, `tarkov_data_evicted`).

## Settings

Not secret, set in `wrangler.jsonc` under `vars` (prerendered pages are built with them, so they
belong in the config, not the dashboard):

| Variable | Value |
| --- | --- |
| `MCP_AUTHKIT_DOMAIN` | The WorkOS AuthKit domain, as set on Vercel today. Empty keeps `/api/mcp` closed (503). |
| `MCP_RESOURCE_URL` | `https://www.eft-toolset.com/api/mcp` (already set) |
| `WORKOS_CLIENT_ID` | The WorkOS client id, as set on Vercel today |
| `CLOUDFLARE_WEB_ANALYTICS_TOKEN` | The Web Analytics site token, as set on Vercel today (empty leaves the beacon out) |
| `APP_ORIGIN` | Leave unset in production. For a test deploy on the `workers.dev` hostname, set it to that origin so sign-in returns there. |

Secrets, set with `wrangler secret put <name>` (never in the config):

| Secret | Value |
| --- | --- |
| `WORKOS_API_KEY` | The WorkOS API key, as set on Vercel today |
| `WORKOS_COOKIE_PASSWORD` | The same 32+ character cookie password as on Vercel, so existing sign-ins keep working |

`MCP_USER_RATE_BURST` and `MCP_USER_RATE_PER_SECOND` are optional (`vars`). Upstash, `CLIENT_IP_HEADER`,
`WARM_TARKOV_CACHE` and the Vercel variables are no longer used.

## WorkOS

Add, without removing anything Vercel uses until the cutover is done:

- Redirect URI `https://www.eft-toolset.com/auth/callback` (already there for Vercel; it stays).
- For a test deploy before cutover: `https://<worker>.<account>.workers.dev/auth/callback`, and set
  `APP_ORIGIN` to that origin for that deploy.
- For local development with sign-in: `http://localhost:3000/auth/callback` (already there).
- Sign-out redirect: `https://www.eft-toolset.com/settings` (already there), plus the `workers.dev`
  `/settings` URL for a test deploy.

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
into the build output. The build needs network access to json.tarkov.dev for the snapshot (it never
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
4. In the Worker's settings, add the custom domain `www.eft-toolset.com`. Cloudflare replaces the
   `www` CNAME with a record for the Worker and issues the certificate.
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
