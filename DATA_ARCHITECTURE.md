# Data architecture

EFT Toolset integrates with Tarkov.dev through a small query system owned by this
application. Tarkov.dev's current public documentation describes JSON responses to GET
requests at `https://json.tarkov.dev`; the previous direct browser GraphQL transport is
not used.

## Request flow

```text
React feature
  -> QueryDefinition (dedupe, TTL, IndexedDB persistence)
  -> apiFetch(operation, variables)
  -> GET /api/tarkov?op=…&v=<canonical JSON>   (single public reads, CDN-cacheable)
     POST /api/tarkov                          (batch reads)
  -> validated operation allowlist
  -> cached json.tarkov.dev resources
  -> localization, ID joins, and narrow projection
  -> feature-specific response
```

The upstream JSON resources are intentionally broad. At the time of migration, the
regular item payload was about 15.8 MB and the map payload about 9.6 MB. They are fetched
server-side, cached in-process, and never forwarded wholesale to a browser.

## Operations

| Operation | Inputs | Result |
| --- | --- | --- |
| `item.catalog` | `gameMode` | Search/catalog item projection |
| `item.group` | `gameMode`, up to 100 names | Item-group prices and task names |
| `item.detail` | `gameMode`, item name or slug | Item, tasks, barters, and crafts |
| `gun.list` | `gameMode` | Weapon-picker rows |
| `gun.build-items` | `gameMode`, up to 100 IDs | Complete build nodes |
| `gun.pick-items` | `gameMode`, up to 100 IDs | Lightweight slot-picker rows |
| `gun.preset` | `gameMode`, preset ID | Base item and contained IDs |
| `gun.ammo-items` | `gameMode`, up to 100 IDs | Ammo ballistics, prices, and trader details |
| `map.details` | `gameMode`, normalized map key | One joined map projection |

Operation names live in `src/app/lib/api/operations.ts`. The route rejects unknown
operations, undeclared variables, invalid game modes, oversized batches, request bodies
over 64 KiB, slow bodies, and URLs over 2 KiB. It does not accept an upstream URL,
resource name, field selection, or arbitrary query.

`item.catalog`, `item.detail`, `gun.list`, `gun.preset`, and `map.details` are also served
over GET. The variables must be canonical JSON (sorted keys, no extra query parameters),
so each logical request has exactly one URL. Successful GETs are sent with
`Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=<n>`, where the
stale window is capped so shared caches never serve data past the six-hour stale ceiling.
Responses built from a failed upstream refresh get a 30-second shared cache, and errors
are `no-store`. Configure the CDN to key on the full query string.

The catalog is sent as `[id, name, shortName, image, normalizedName]` tuples, where an
empty image means the standard `{id}-grid-image.webp` asset.

## Item pages

Item pages live at `/item/<normalizedName>` and are rendered on the server with the
adapter's data for the visitor's game mode, read from the `eft-game-mode` cookie that the
client keeps in sync with its stored setting. The client query cache is seeded with the
same data. Older name-based links redirect permanently, unknown slugs return 404, and if
the adapter takes longer than 2.5 seconds the page renders and loads data in the browser
instead. Every item slug is listed in the sitemap.

## MCP endpoint

`/api/mcp` is a public, read-only [Model Context Protocol](https://modelcontextprotocol.io)
server using the Streamable HTTP transport in stateless mode. The route is a thin wrapper
around `handleMcpPost` in `src/app/lib/mcp/http.ts`. Each POST carries one JSON-RPC message
and builds a fresh server, so no session state lives between requests and any instance can
serve any request. Responses are JSON; GET and DELETE return 405, and JSON-RPC batches,
which MCP dropped in 2025-06-18, return 400.

Limits:

- Each request is charged from its payer's MCP budget and the instance's global MCP budget
  (`src/app/lib/mcp/budget.ts`), both kept apart from the website's, so assistants can't
  starve the site. The payer is the client's IP, or the user when the request carries a valid
  access token (see [MCP sign-in](#mcp-sign-in)). Tool calls cost 1 token, `modify_build` 2,
  and `optimize_build` 3; everything else costs 0.25. That base cost is charged before the
  body is read, and a tool call pays the rest once the body is parsed, or gets the base cost
  back in the same step if it can't.
- Payer budgets live in Upstash Redis when `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set (`src/app/lib/api/rate-limit-store.ts`): one atomic Lua
  token bucket per payer, under a hashed key, so IPs and user ids never reach Redis. Each
  request costs one Redis command, and a tool call two. Without Upstash, or when it can't be
  reached within a second, each instance counts in memory as before.
- A tool call takes a slot from the shared operation pool, and at most 6 run at once per
  instance. Handshakes and lists don't wait for slots.
- Bodies may be up to 1 MiB, and at most 16 are read at once, apart from the website's 32
  (`src/app/lib/api/request-body.ts`).
- Tools stop at 40 seconds and return a tool error. The optimiser, which is CPU-bound, gets
  one 20-second limit per tool call and at most 2 runs at once per instance.
- `optimize_build` and `modify_build`, the tools that run the optimiser, keep their last 64
  results per instance (`src/app/lib/mcp/result-cache.ts`). A repeated call with the same
  arguments is answered from there while every tarkov.dev dataset it was built from is still
  the same copy, for up to 30 minutes. Results built from stale data aren't kept.

Requests with no `Origin` header (most clients), from this site, or from localhost (such as
the MCP Inspector) are accepted, and CORS headers echo the allowed origin; other browser
origins get 403, including on preflight. Responses are `no-store`. Links in results point
to the canonical site in production and to the request's origin in development. Each tool
call logs one JSON line (`event: "mcp_tool_call"`) with a request id, the tool, game mode,
outcome, duration, whether the data was stale, and whether the result came from the cache. Unexpected failures return the request
id as a reference.

`get_wiki_page` is the one tool that doesn't read tarkov.dev. It reads a snapshot of the
community Escape from Tarkov Wiki in `data/wiki`, built from the XML dump of current pages that
Fandom publishes for download, and makes no requests to the wiki at runtime.
`node scripts/build-wiki-snapshot.mjs` downloads the dump named in `data/wiki/manifest.json`
(or `--url <url>`), or takes a downloaded `.7z` with `--file <path>` (add
`--last-modified <HTTP date>` to record its date), unpacks it with `7z-wasm`, and writes a file
per page; `--check` sends one HEAD request for the dump and prints whether it is newer than the
one in the manifest, which records the dump's URL, size, SHA-256, Last-Modified date, and the
time of its latest edit (the snapshot date). Output depends only on the dump, so rebuilding an
unchanged dump changes nothing. `src/app/lib/wiki/wikitext.ts` turns each page's wikitext into
its first infobox as fields and its sections as plain text: tables as rows, links as their
text, and no images, references, navigation boxes, comments, hidden elements, or invisible
characters.

The snapshot keeps the pages tarkov.dev can't answer for: quests, bosses and other characters,
maps, traders, keys and keycards, loot containers, skills, and mechanics and lore (pages in the
wiki's "Escape from Tarkov", "Game modes", and "Story chapters" categories). Item, weapon, mod,
and ammo pages are mostly the stats tarkov.dev already serves, and pages marked as historical
describe removed content, so those are left out; `data/wiki/left-out.json` names them, so asking
for one points the model to `search_items`, `get_item`, `get_weapon`, or `get_ammo_options`
instead. `data/wiki/index.json` lists every kept page and redirect (with the section a redirect
points at); it is read once per instance, and pages are read one file at a time as they are
asked for, so a cold start loads about 150 KB. `next.config.mjs` traces `data/wiki` into the
MCP function. Titles match exactly, through a redirect, or ignoring case and punctuation; a
miss returns up to eight titles sharing the most words with the request. Without `sections`,
pages up to 4,000 characters come back whole and longer ones as their introduction, with the
section list for asking by heading; results are cut at 12,000 characters. Wiki text is written
by anyone, so the tool description, the `content` field, and the server instructions all tell
the model to treat it as reference rather than instructions. The wiki is licensed CC BY-NC-SA,
so every result carries a credit line naming the page, its contributors, the licence, and that
it was adapted from the dump of a given date (see the README's Credits section).

`lookup_term` reads no service at all. It answers from a curated glossary of player jargon
(`src/app/lib/glossary/terms.json`): map callouts, item and ammo nicknames, bosses, traders,
mechanics, and slang, each with a meaning written for the glossary and the URL of a source
(mostly wiki pages; Reddit threads or community glossaries for pure slang). Each landmark
names the place its position comes from: a label on tarkov.dev's interactive map, or an
extract, key lock, spawn zone, or other place in the map data. `node scripts/build-glossary.mjs`
resolves those anchors and every named item against live data (tarkov.dev's `maps.json`, and
`get_map_details` and `search_items` on the production MCP endpoint, or `EFT_MCP_URL`) and
writes the positions and item ids back into `terms.json`, plus the map labels into
`map-labels.json`. Run it after editing the glossary or after a map update; it exits non-zero
when an anchor or item no longer exists. Map labels that no curated entry covers are served as
landmarks too. The script describes each label from the map data around it
(`scripts/describe-labels.mjs`: the part of the map, the nearest landmark and extract with
distance and direction on tarkov.dev's north-up map, and nearby locks, boss spawns, and
containers), after a wiki description from `label-notes.json` where the wiki has one.
`create_raid_plan` accepts any landmark's name or alias as a place on its map when the map
data has no place of exactly that name.

The layers are kept apart:

- `src/app/lib/mcp/` holds only schemas, registration, and result shaping. `catalog.ts`
  defines every tool's name, title, description, and the summary the `/mcp` page shows, and
  the server instructions list the tools from it. Tools are registered through
  `define-tool.ts`, which adds the catalog entry, annotations, and `runTool`'s error
  handling, logging, and stale-data notice. `schemas.ts` holds the shared input schemas and
  `output-schemas.ts` the output schemas, which TypeScript checks each tool body against and
  the SDK enforces at runtime.
- Resolving references lives with the feature it belongs to:
  `src/app/lib/search/item-reference.ts` (items), `src/app/lib/builds/resolve.ts` (weapons,
  presets, trees, slot paths, ammo), and `src/app/lib/raid-planner/resolve.ts` (maps, named
  places, spawn zones, plan links). They throw `InputError`, whose message the tool returns.
- Builds load data through a `BuildSource`, so the resolver doesn't depend on the adapter.

Tools call the adapter's projections (`getItemCatalog`, `getItemDetail`, `getGroupItems`,
`getGunList`, `getAmmoItems`, `getPreset`, `getMapDetails`) inside `runTarkovRead`, which
applies the same cancellation and stale-data tracking as the route. Results built from stale
data carry a `dataNotice` with the data's age. `getGunPartLookup` projects every weapon and
every part any slot accepts once per upstream refresh, so builds are evaluated and optimised
with the browser's own modules (`src/app/lib/builds/*`).

Trader offers carry the task that unlocks them (`taskUnlock`), and a weapon also gets its
default preset's offers, marked with the preset, since traders sell most weapons only as a
preset. The MCP lookup also carries the barters that give each part, priced per item at what
their inputs cost (the cheapest trader price or flea 24-hour average). `priceSources` limit
offers by loyalty level and, with `excludeQuestLocked`, by `completedTasks`, which are matched
by id, name, or slug and expanded to the tasks they required (`src/app/lib/builds/quests.ts`).
Build results list `requiredTasks`: the tasks behind the offers the build is priced with, and
their prerequisites, in an order they can be done (`getTaskIndex`).

A weapon bought as its default preset (a trader's preset offer, a preset barter, or the flea
market, whose weapon prices are for the default preset) comes with the preset's parts.
`planPurchase` (`src/app/lib/builds/purchase.ts`) prices a build both ways, the bare weapon and
every part or the preset and only the parts it lacks, and keeps the cheaper; the build cost, the
shopping list, and the optimiser (which solves both ways) all use it, in the app and the MCP
tools. Without the preset's contents, every part is priced.

Results put the payload in `structuredContent` and as JSON text. Builds are passed between
calls as a share link, or restated as a weapon, preset, and `parts` (each part's slot path
and item, as build results list them). List tools take `offset` and return `nextOffset`
while more results remain. Raid plans use the planner's share codec and validation.
`create_import_link` encodes a backup with the share codec into a `/data#import=…` link,
which the Backup & restore page decodes and shows for review before Merge; it uses the store
keys in `src/app/lib/storage/store-keys.ts`.

### MCP sign-in

Sign-in is optional and off unless `MCP_AUTHKIT_DOMAIN` is set; without it the endpoint
advertises no auth and ignores `Authorization` headers. With it, WorkOS AuthKit is the
authorization server (`src/app/lib/mcp/auth.ts`):

- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`
  serve the protected resource metadata (RFC 9728), naming the AuthKit issuer. AuthKit runs
  the OAuth flow, with PKCE, client registration (CIMD or DCR), and consent.
- A request with `Authorization: Bearer <token>` is checked against AuthKit's JWKS: an
  asymmetric signature, the AuthKit issuer, the MCP URL (`MCP_RESOURCE_URL`) as audience, and
  expiry, with 30 seconds of clock tolerance. Agent tokens (`sub_profile: ai_agent`) are
  refused. A valid token charges the user's own budget, keyed on `sub`. A bad token is always
  challenged (below), whatever the IP's budget, since the challenge is what makes clients
  refresh; if the keys can't be fetched the request gets 503.
- Anonymous callers keep the per-IP budget. When an IP runs out, the endpoint asks the
  client to sign in rather than wait. A tool call gets a tool error (status 200) whose
  `_meta["mcp/www_authenticate"]` carries the challenge, which is how ChatGPT starts sign-in;
  every tool in `tools/list` declares `securitySchemes` of `noauth` or `oauth2` (top-level and
  mirrored in `_meta`), which ChatGPT needs before it offers sign-in for a tool. Any other
  request gets 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, which Claude and
  other clients that follow the MCP spec act on. Clients drop a 401's body, so one response
  can't carry both: a spec client that runs out mid-conversation is asked on its next
  `initialize` or `tools/list`. Bad tokens always get 401 with `error="invalid_token"`, which
  is what makes clients refresh them.
- Signed-in users over their budget get 429, as everyone did before. So does anyone when
  the instance's global budget runs out, since signing in can't help there.

Reading the body to answer a tool call's challenge is the one read a client over its budget
can trigger; reads stay capped by size, time, and the MCP pool's concurrency limit.

## Upstream resources

- Items, weapon structures, prices, presets: `/{gameMode}/items` and `_en`.
- Trader names: `/{gameMode}/traders` and `_en`.
- Task relations: `/{gameMode}/tasks` and `_en`.
- Barter and craft relations: `/{gameMode}/barters` and `/crafts`.
- Hideout station names: `/{gameMode}/hideout` and `_en`.
- Raid-planner data: `/{gameMode}/maps` and `_en`.

External requests have a 20-second timeout, a 32 MiB response-size guard, status and
shape validation, and a bounded resource allowlist. Upstream failures are translated to
a stable `UPSTREAM_UNAVAILABLE` response without exposing internals.

tarkov.dev asks only that clients use common sense, so the adapter keeps its requests few
and identifiable:

- Every request sends `User-Agent: EFT-Toolset/1.0 (+https://www.eft-toolset.com; …/issues)`
  (`src/app/lib/api/user-agent.ts`).
- Each dataset has its own freshness in `RESOURCE_POLICIES`, set from how often tarkov.dev
  changes it: items (prices) 5 minutes, maps and tasks 30 minutes, everything else 2 hours.
- Refreshes send the `ETag` and `Last-Modified` the dataset came with, so an unchanged
  dataset is answered with a 304 and no body.
- Callers share a refresh in progress, and an instance has at most 4 tarkov.dev requests in
  flight; the rest queue. A burst of tool calls or page loads therefore costs at most one
  request per dataset.
- After a failed refresh, that dataset isn't requested again for 30 seconds, doubling to
  10 minutes, with jitter, or for as long as a `Retry-After` asks (up to an hour). Meanwhile
  callers get the stale copy, or fail at once when there is none.

Worst case for one instance, with every dataset in use in both game modes: items 24, maps
and tasks 8, `items_en` 1 request an hour, 33 an hour, most of them 304s. The shared
datasets add about 8 an hour per region, however many instances run. A new instance makes
at most 8 full downloads (the four unshared datasets in each mode); after a failure, at most
one request per dataset per backoff interval.

## Cache ownership

- The server resource cache amortizes large upstream downloads and JSON parsing. Each
  resource is fresh for its policy's time, then revalidated in the background without
  blocking requests (items for up to 30 minutes, maps and tasks 2 hours, the rest 4 hours),
  and served stale (flagged with `X-EFT-Data-Stale`) for up to six hours when tarkov.dev is
  down.
- Small datasets that rarely change (barters, crafts, hideout, traders, and the task, map,
  hideout, and trader translations) are also kept in Vercel's Runtime Cache
  (`src/app/lib/api/shared-cache.ts`), which every instance in a region shares. A body is
  written only when it changes, under its version, and a small record says when an instance
  last checked it with tarkov.dev; another instance reuses the shared copy while that check
  is within the dataset's freshness. Items (17 MB), maps (9 MB), tasks (2 MB), and item
  names (1.7 MB) stay per instance: they exceed or approach Runtime Cache's 2 MB item limit,
  and the Hobby plan's write allowance (200K 8 KB units a month) is shared by the whole
  team. The shared cache is best effort: failures and timeouts read as misses, and it is
  off outside Vercel.
- Projections and indexes are memoized on the identity of their source resources, so they
  are rebuilt only when upstream data changes.
- `src/instrumentation.ts` warms the item catalog for both game modes at boot. Set
  `WARM_TARKOV_CACHE=0` to disable.
- The client query layer deduplicates concurrent requests and controls stale/max ages.
- IndexedDB holds validated query projections for fast reloads and offline-tolerant stale
  data. Query schema-version bumps invalidate incompatible projections.
- Gun-builder entries keep their existing per-ID TTL envelopes so opening one slot does
  not refetch an entire build tree.

## Rate limiting

The route keeps an in-process token bucket per client and a global bucket, and server-
rendered pages share the API's concurrency cap. (The MCP endpoint's own budgets, which can
live in Redis, are described under [MCP endpoint](#mcp-endpoint).) On Vercel the client is identified by
`X-Real-IP`, which Vercel sets itself. Elsewhere set `CLIENT_IP_HEADER` to the single header
your proxy sets authoritatively and block direct origin access. Without it, forwarding
headers could be forged to dodge the per-client limit, so clients aren't told apart and only
the global bucket applies (and production logs a warning once).

Successful public GETs are cached by Vercel's edge network, which honours `s-maxage` and
`stale-while-revalidate` and keys on the full URL including the query string.

## Adding a query

Add a constant to the operation allowlist, declare its variables in
`OPERATION_VARIABLES` and validate them in the server dispatcher, build a narrow response projector, and call it through `apiFetch`. Add fixture
coverage for joins/localization and a live smoke check against both game modes when the
upstream shape changes. Do not expose generic resource paths or restore arbitrary query
text to the browser.

References: [Tarkov.dev API documentation](https://tarkov.dev/api/) and the
[machine-readable endpoint list](https://json.tarkov.dev/endpoints).
