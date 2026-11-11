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

- Each request is charged from the client's MCP budget and the global MCP budget
  (`src/app/lib/api/rate-limit.ts`), both kept apart from the website's, so assistants can't
  starve the site. Tool calls cost 1 token, `modify_build` 2, and `optimize_build` 3;
  everything else costs 0.25. That base cost is charged before the body is read, and a tool
  call pays the rest once the body is parsed, or gets the base cost back if it can't.
- A tool call takes a slot from the shared operation pool, and at most 6 run at once per
  instance. Handshakes and lists don't wait for slots.
- Bodies may be up to 1 MiB, and at most 16 are read at once, apart from the website's 32
  (`src/app/lib/api/request-body.ts`).
- Tools stop at 40 seconds and return a tool error. The optimiser, which is CPU-bound, gets
  one 20-second limit per tool call and at most 2 runs at once per instance.

Requests with no `Origin` header (most clients), from this site, or from localhost (such as
the MCP Inspector) are accepted, and CORS headers echo the allowed origin; other browser
origins get 403, including on preflight. Responses are `no-store`. Links in results point
to the canonical site in production and to the request's origin in development. Each tool
call logs one JSON line (`event: "mcp_tool_call"`) with a request id, the tool, game mode,
outcome, duration, and whether the data was stale. Unexpected failures return the request
id as a reference.

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

Results put the payload in `structuredContent` and as JSON text. Builds are passed between
calls as a share link, or restated as a weapon, preset, and `parts` (each part's slot path
and item, as build results list them). List tools take `offset` and return `nextOffset`
while more results remain. Raid plans use the planner's share codec and validation.
`create_import_link` encodes a backup with the share codec into a `/data#import=…` link,
which the Backup & restore page decodes and shows for review before Merge; it uses the store
keys in `src/app/lib/storage/store-keys.ts`.

## Upstream resources

- Items, weapon structures, prices, presets: `/{gameMode}/items` and `_en`.
- Trader names: `/{gameMode}/traders` and `_en`.
- Task relations: `/{gameMode}/tasks` and `_en`.
- Barter and craft relations: `/{gameMode}/barters` and `/crafts`.
- Hideout station names: `/{gameMode}/hideout` and `_en`.
- Raid-planner data: `/{gameMode}/maps` and `_en`.

External requests have a 45-second timeout, a 32 MiB response-size guard, status and
shape validation, and a bounded resource allowlist. Upstream failures are translated to
a stable `UPSTREAM_UNAVAILABLE` response without exposing internals.

## Cache ownership

- The server resource cache amortizes large upstream downloads and JSON parsing. Resources
  are fresh for five minutes, revalidated in the background without blocking requests for
  up to 30 minutes, and served stale (flagged with `X-EFT-Data-Stale`) for up to six hours
  when tarkov.dev is down.
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
rendered pages share the API's concurrency cap. On Vercel the client is identified by
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
