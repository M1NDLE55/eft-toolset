# Data architecture

EFT Toolset integrates with Tarkov.dev through a small query system owned by this
application. It reads tarkov.dev's JSON API: JSON responses to GET requests at
`https://json.tarkov.dev`.

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
| `item.detail` | `gameMode`, item name or slug | Item, tasks, barters, and crafts; for keys, the maps whose locks they open and what they open |
| `gun.list` | `gameMode` | Weapon-picker rows |
| `gun.build-items` | `gameMode`, up to 100 IDs | Complete build nodes |
| `gun.pick-items` | `gameMode`, up to 100 IDs | Lightweight slot-picker rows |
| `gun.preset` | `gameMode`, preset ID | Base item and contained IDs |
| `gun.ammo-items` | `gameMode`, up to 100 IDs | Ammo ballistics, prices, and trader details |
| `map.details` | `gameMode`, normalized map key | One joined map projection |
| `market.board` | `gameMode` | Top 48-hour flea movers and best sell value per slot |
| `quest.list` | `gameMode` | Every quest with its requirements and item needs, and the items and maps they name |
| `price.feed` | `gameMode` | Every item's prices, for instances to read prices from (see [Price feed](#price-feed)) |

Operation names live in `src/app/lib/api/operations.ts`. The route rejects unknown
operations, undeclared variables, invalid game modes, oversized batches, request bodies
over 64 KiB, slow bodies, and URLs over 2 KiB. It does not accept an upstream URL,
resource name, field selection, or arbitrary query.

`item.catalog`, `item.detail`, `gun.list`, `gun.preset`, `map.details`, `market.board`, `quest.list`, and `price.feed` are also served
over GET. The variables must be canonical JSON (sorted keys, no extra query parameters),
so each logical request has exactly one URL. Successful GETs are sent with
`Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=<n>`, where the
stale window is capped so shared caches never serve data past the six-hour stale ceiling.
Responses built from a failed upstream refresh get a 30-second shared cache, and errors
are `no-store`. Configure the CDN to key on the full query string.

`price.feed` has its own, shorter cache (see [Price feed](#price-feed)).

The catalog is sent as `[id, name, shortName, image, normalizedName]` tuples, where an
empty image means the standard `{id}-grid-image.webp` asset.

## Page caching

Content pages (items, quests, ammo, keys, best and Gunsmith builds, the hubs, raid-planner
maps and the sitemap) are rendered once and cached at the CDN with incremental static
regeneration: each page exports `revalidate` and `dynamic = "force-static"`, and a stale copy is
served while it renders again in the background. Hubs and map pages are built with the site;
pages with a parameter render on their first visit (`generateStaticParams` returns nothing).
Nothing in the render reads the request, so there is no middleware and no per-request CSP
nonce: the security headers, CSP included, come from `next.config.ts`
(`src/app/lib/security/headers.ts`).

| Pages | Revalidate |
| --- | --- |
| `/item`, `/flea-market/pve`, `/ammo`, `/ammo/<calibre>`, `/keys/<map>` (prices are the content) | 5 minutes |
| `/item/<slug>` (prices also refresh in the browser) | 6 hours |
| `/gun-builder/best`, `/gun-builder/best/<weapon>`, `/gun-builder/gunsmith`, `/gun-builder/gunsmith/<task>` | 6 hours |
| `/quests`, `/quests/<slug>`, `/keys`, `/raid-planner/map/<map>`, `/sitemap.xml` | 24 hours |

A render waits up to 15 seconds for its data (`src/app/lib/api/server-render.ts`), queueing
for an operation slot rather than giving up. Renders hold at most 12 of the 16 slots, so
`/api/tarkov` and MCP calls, which answer busy rather than wait, always have some left. When a page's main data still can't be read, the
render throws: a background render keeps the previous copy, and a first render answers with a
500 that isn't cached, so crawlers retry later rather than indexing an empty page. Pages are
never marked `noindex` for a temporary failure.

Pages whose data depends on the game mode have a PVE copy under `/pve/...`
(`src/app/lib/game-mode-routes.ts`). `next.config.ts` rewrites to it for visitors whose
`eft-game-mode` cookie, which the client keeps in sync with its stored setting, says PVE. The
rewrite runs in Vercel's routing, so both modes are cached separately and the PVP copy, which
crawlers get, doesn't depend on it. `/pve/...` URLs redirect to the real page. When a visitor
switches mode, `useServerModeSync` refreshes the route, which the rewrite now sends to the
other copy.

## Item pages

Item pages live at `/item/<normalizedName>` and are rendered on the server with the
adapter's data for their game mode (see Page caching). The client query cache is seeded with
the same data and refetches it once it is older than five minutes, so a cached page still
shows live prices. Older name-based links redirect permanently and unknown slugs return 404.
Every item slug is listed in the sitemap.

An item page is a grid of cards (`src/app/components/item/cards.tsx`), laid out by a view:
Raid, Standard and Full are built in, each showing everything the one before does and more,
and visitors can copy one into their own view to reorder, resize, add and remove cards.
Views are kept in local storage (`src/app/lib/item-views/store.ts`) and included in backups.
The cached page is rendered with Standard, and the visitor's own view applies when the page
hydrates. Besides prices and uses, `item.detail` returns the item's description, weight,
category, flea statistics, and the barters and crafts that give it. For keys it also returns
the maps with a keys page whose locks they open, with a lock count for each, and what they
open, from the wiki snapshot's infobox (so `/api/tarkov` traces the snapshot's item pages).

The Full view adds the item's wiki page, read on the server from the snapshot below by
tarkov.dev id (`src/app/lib/wiki/item-wiki.ts`), and passed to the page with the item. It
shows where to find the item (and for keys, the lock and what's behind it), notes, and a few
infobox facts, each with a credit line linking the page.

The item prices page (`/item`) and each map page render more of the adapter's data the
same way, through `readForRender` in `src/app/lib/api/server-render.ts`: the most valuable
items per slot, overall and among keys, and a written guide under each map (extracts,
transits, bosses and keys). Without the data in time, they render without those sections.

## Best weapon builds

`/gun-builder/best` lists every weapon in the main classes (assault rifles to pistols), and
`/gun-builder/best/<weapon slug>` shows that weapon's factory preset next to the lowest
recoil and the max ergonomics build. `src/app/lib/builds/best-builds.ts` runs the gun
builder's optimiser on the server from the default preset, with trader and flea prices, and
keeps each weapon's result for an hour per instance (sooner when the part data changes).
Optimiser runs share a per-instance limit with the MCP tools (`optimizer-slots.ts`). If the
builds can't be worked out in time, the render fails (see Page caching). Pages are cached for
six hours, so the optimiser runs when a page is rendered again, not per request.
Each build links to the gun builder as a share link. Every weapon page is in the sitemap.

## Gunsmith builds

`/gun-builder/gunsmith` lists every task with a `buildWeapon` objective (the Gunsmith chain
and a few others), and `/gun-builder/gunsmith/<task slug>` shows each objective's
requirements and a build that meets them. `getWeaponBuildTasks` reads the objectives' stat
limits (`buildAttributes`), required parts (`containsAll`) and part categories
(`containsCategory`) from tarkov.dev's task data.

`src/app/lib/builds/gunsmith.ts` solves an objective from the weapon's default preset:

1. It installs the required parts, then a part from each required category, a sight that
   reaches the sighting range, and a small enough magazine. Each comes with the parts it
   hangs from: chains up to four parts long are found through a reverse index of which parts
   accept which.
2. It trims the build to those parts and their holders.
3. It lets the optimiser fill the rest, with each goal and with mixes of ergonomics, recoil
   and weight (the optimiser's internal `blend` option).
4. It keeps the cheapest result that passes every check.

The recoil requirement is vertical plus horizontal recoil, and sighting range is the longest
among the weapon and its sights. Durability and build size aren't in the data, so pages mark
them as checked in game. When nothing passes, the page shows the closest attempt and a
starting build. Results are kept for an hour per instance, and optimiser runs share the
limit in `optimizer-slots.ts`.

## Quests

`/quests` lists every quest in the visitor's game mode and `/quests/<slug>` shows one. Both
read tarkov.dev's task data through the adapter:

- `getQuestList` (the `quest.list` operation) projects each task to a `QuestSummary`
  (`src/app/lib/quests/types.ts`): trader, level, faction, Kappa and Lightkeeper flags, maps,
  requirements with the statuses that meet them, the quests whose completion fails it,
  trader levels, keys, objective ids, and item needs. Items and maps come once each, in
  dictionaries beside the quests. Pages render it with `loadQuestList`
  (`src/app/quests/load.ts`) and seed the client query cache with it, as item pages do; the
  client refetches it when the game mode changes.
- `getQuestDetail` adds objectives, rewards (items, standing, offer, craft and trader unlocks,
  skills), what the quest unlocks, the chain before and after it, and buy and sell prices for
  every item it names. It is rendered on the server only, through `loadQuestDetail`.

Slugs are tarkov.dev's `normalizedName`, which is already unique per task (faction versions
come as `-usec` and `-bear`, repeated names with a number). `questSlugs` guards against that
changing: should two tasks ever share one, they get `-usec` or `-bear` (a task for every faction
keeps the plain slug), and anything still shared gets the task id. Tasks without a valid slug
have no page. Zone quests have a copy in each game mode that differs only
in its `-pvp-zone` or `-pve-zone` suffix, so a page asked for in the other mode shows this
mode's copy; a quest only the other mode has is shown from that mode.

An item need is one objective that takes items (hand over, plant, sell, mark, or use), with
any find objective for the same items, so finding and handing over count once; a find
objective with no hand-over is a need of its own. An objective any of several items meets
stays one need with its alternatives, and when too many qualify to list, only its
description. Maps are keyed by tarkov.dev's map `normalizedName`; variants (night Factory,
Ground Zero 21+, the dark Lab and others) name the raid planner and keys page they share.

Quests come grouped by trader in the game's order (Prapor, Therapist, Fence, Skier,
Peacekeeper, Mechanic, Ragman, Jaeger, Ref, Lightkeeper, BTR Driver, then any others), and
within a trader in the order they're played (`src/app/lib/quests/order.ts`): never before a
quest of the same trader they need, otherwise by level (0 and 1 alike), then by id. The game's
ids begin with the time the quest was made, which follows each trader's line where tarkov.dev
gives neither a level nor a prerequisite.

Wherever a quest or objective names its maps (list rows, Available now, quest pages), variants
merge into the map whose page they share, as the Map filter groups them, and eight or more maps
read "Any map" (`mapLabels` in `display.ts`).

`src/app/lib/quests/` holds the browser's logic: the requirement graph, each quest's state
from progress, level and faction, the items still needed, the chain layout, and the list
filters. Progress (completed quests, done objectives, level, and faction) is kept per game mode
in local storage (`progress-store.ts`) and included in backups.

- A quest is failed when a quest that fails it is complete. Trader loyalty isn't tracked.
  Once the faction is set, a requirement on a quest only the other faction gets is ignored,
  since some quests for both factions require a USEC-only one.
- Completing a quest also marks the quests it strictly needed completed, except quests only for
  the other faction. Un-completing one that later completed quests needed asks first, and can
  un-mark only it or them too.
- Items needed adds up the needs of the quests left, found-in-raid apart. Both sides of a
  choice not made yet count. With no faction set, a quest's USEC and BEAR versions (same
  trader, name and prestige) count once: the larger need per item, shown against that version.
- The chains view (`chain-layout.ts`) stacks each group of a trader's quests linked by that
  trader's own requirements as a block, the biggest first, one column per depth. Quests with
  no such link are listed apart under it as standalone quests. Each column keeps the list's
  play order. Quests that share a name and
  faction get a short hint (what they follow, their map or level) to tell them apart.

Quest pages show the guide from the wiki snapshot (`src/app/lib/wiki/quest-wiki.ts`), found by
the task's wiki link and only if it is a quest's page, without the objectives, rewards, and
requirements tarkov.dev serves, and with the dialogue apart. It carries the same credit line as
the item page. It also passes the page's map and location pictures (see "Quest images" under the
wiki snapshot below) as file names and hash paths with their credits; the browser builds each
image URL and loads it from the wiki's image host, so the server never fetches, stores or
serves the images, and the page's HTML doesn't contain their URLs.

## Ammo, keys and PVE prices

- **`/ammo` and `/ammo/<calibre slug>`** chart every round by calibre from `getAllAmmo`. The
  calibre slug comes from its readable name ("5.56x45mm NATO" → `5-56x45mm-nato`). Each
  round has its stats and its cheapest trader or flea price, and calibre pages link to that
  calibre's best-build pages.
- **`/keys` and `/keys/<map>`** list the keys that open locks on each map, from the map
  details. Each key has its group-item prices and the tasks that use it. Maps without keys
  return 404.
- **`/flea-market/pve`** always shows the PVE price tables, with a button that switches the
  site to PVE.

All three render for their game mode (PVE for the PVE page) and fail like the other pages
when their data can't be read (see Page caching).

## MCP endpoint

`/api/mcp` is a read-only [Model Context Protocol](https://modelcontextprotocol.io) server for
signed-in users (see [MCP sign-in](#mcp-sign-in)), using the Streamable HTTP transport in stateless mode. The route is a thin wrapper
around `handleMcpPost` in `src/app/lib/mcp/http.ts`. Each POST carries one JSON-RPC message
and builds a fresh server, so no session state lives between requests and any instance can
serve any request. Responses are JSON; GET and DELETE return 405, and JSON-RPC batches,
which MCP dropped in 2025-06-18, return 400.

Limits:

- Each request is charged from its payer's MCP budget and the instance's global MCP budget
  (`src/app/lib/mcp/budget.ts`), both kept apart from the website's, so assistants can't
  starve the site. The payer is the signed-in user, or the client's IP in development without
  sign-in. Tool calls cost 1 token, `modify_build` 2,
  and `optimize_build` 3; everything else costs 0.25. That base cost is charged before the
  body is read, and a tool call pays the rest once the body is parsed, or gets the base cost
  back in the same step if it can't.
- Payer budgets live in Upstash Redis when `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set (`src/app/lib/api/rate-limit-store.ts`): one atomic Lua
  token bucket per payer, under a hashed key, so IPs and user ids never reach Redis. Each
  request costs one Redis command, and a tool call two. Without Upstash, or when it can't be
  reached within a second, each instance counts in memory as before; after a failure it counts in
  memory for 15 seconds without asking Upstash, so a burst doesn't wait out the timeout on every call.
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

Results with item prices also carry `priceSource`: `kind` is `live` (from a copy whose refresh
didn't fail, at most 5 minutes old, the length of tarkov.dev's update cycle), `cached` (older, or
its refresh failed) or `snapshot` (the copy bundled with the deployment), with `ageSeconds` since
tarkov.dev confirmed the prices. Like `dataAsOf` and `dataNotice` it is described once in the server
instructions rather than in each tool's published output schema. `get_data_status` also lists the
price feed per game mode (on or off, its age, state, and any retry wait); with the feed on, the
`items` dataset shows as due, since it is no longer refreshed for prices. See
[Data paths by tool](#data-paths-by-tool) for what each tool reads.

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
MCP function, the item pages, and the quest pages.

Item, weapon, and ammo pages are also written, apart, to `data/wiki/items/` for the item page,
without the sections that repeat tarkov.dev (description, trading, crafting, hideout, quests,
attachments) or hold only media. `data/wiki/item-ids.json` maps each tarkov.dev item id, taken
from the infobox's `node` field, to its page in `items/` or `pages/` (for keys); `get_wiki_page`
doesn't read either. Titles match exactly, through a redirect, or ignoring case and punctuation; a
miss returns up to eight titles sharing the most words with the request. Without `sections`,
pages up to 4,000 characters come back whole and longer ones as their introduction, with the
section list for asking by heading; results are cut at 12,000 characters. Wiki text is written
by anyone, so the tool description, the `content` field, and the server instructions all tell
the model to treat it as reference rather than instructions. The wiki is licensed CC BY-NC-SA,
so every result carries a credit line naming the page, its contributors, the licence, and that
it was adapted from the dump of a given date (see the README's Credits section).

**Quest images.** Quest pages in the snapshot also carry an `images` list: the pictures on the
wiki page that help with the quest (maps with markers, location screenshots, in-raid spots,
build screenshots), each as `{ file, hashPath, caption, section, subsection }`, plus
`sectionOccurrence` and `subsectionOccurrence` when the page repeats that heading (two Guide
sections, or a Woods subsection under two objectives): how many namesakes come before it, counted
as `groupWikiSections` counts them, so the image shows in the right one.
`scripts/wiki-images.mjs` collects `[[File:…]]` and `[[Image:…]]` links and `<gallery>` entries
with the section and subsection each sits in (cleaning the text as the page parser does, with
`stripHidden`, so headings match), takes the caption (or the alt text) as plain text,
and normalises each name as MediaWiki does (underscores for spaces, runs collapsed, first letter
upper case). `hashPath` is the first one and two hex digits of the name's md5, the directories
the wiki keeps the file under (`Delivery_from_the_past_Customs.png` → `4/4a`), so the image URL
is `https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/<hashPath>/<file>`.
Each file is listed once per page. Left out:

- names containing "icon", "portrait", "banner" or "QuestPicture", item inspect pictures
  (`_ins.`), main menu backgrounds, and SVGs;
- files linked to another page (item pictures link to the item) and tab labels
  (`class=wds-tabs…`); a link to the file itself (`{{filepath:…}}`) is kept;
- files drawn at 128px wide or less (a height-only size such as `x300px` states no width);
- files in the Objectives, Rewards, Dialogue, Initial equipment, and Trivia sections (reward
  previews, item rows, asides). Requirements stay, since story quests show there where a quest
  starts;
- the infobox's picture, which is a template field rather than a file link.

The quest page shows every image once, by the objectives, and the wiki guide's text below without
them (`src/app/lib/quests/wiki-images.ts`). Only objectives on a map count, other than surviving the
raid or anything on most maps. Captions are matched against every game map's name (Lab and Labs
too; not Terminal, a common word in guides), and a variant counts as its base map. An image goes under an objective when its subsection or caption (or failing those, its file
name) names a map only one of them is on, or several are and the caption's words appear in only
one's description; when it names no map but its caption's words appear in only one description;
when it follows, in the same part of the page, an image that went under an objective and its words
don't point at another; or when it's in the guide and only one objective is on a map. The rest go
in a strip right under the objectives, grouped and labelled by subsection (or by section, outside
the guide).
The manifest counts the quest pages with images, the images on them, and the distinct files.

The grid shows the CDN's scaled copies (`<image URL>/revision/latest/scale-to-width-down/<width>`,
with a 400, 800 and 1200 wide srcset); only the enlarged view loads the original. The CDN serves
them with the page's Referer (`strict-origin-when-cross-origin`) and turns away requests with
none or with an unknown query string, so the URLs carry no query. An image that fails to load is
tried twice more, after a short wait, before it becomes a link to its file page.

**Image credits.** After writing the pages, `scripts/build-wiki-snapshot.mjs` makes one pass over
the wiki's MediaWiki API (`scripts/wiki-image-credits.mjs`): `meta=siteinfo&siprop=rightsinfo`
once for the licence, then `prop=imageinfo&iiprop=user|url` for up to 50 files per request, one
request after another with a second between them, `maxlag=5`, and the same User-Agent as the dump
download. It writes `data/wiki/image-credits.json` as
`{ fetchedAt, licence, images: { [file]: { uploader, filePage } } }`, where `uploader` is who
uploaded the file's current version and files the wiki doesn't have are marked `missing`. It
also compares the URL it builds from each name with the one the API returns and prints any that
differ. `--no-credits` skips the pass, and so does any failure to read the API (a network error,
an error response, or an HTML page such as a challenge, which isn't retried): the build then
keeps the existing credits, writes `uploader: null` for new files, and drops files no page
shows any more. Page files never depend on the API, so the snapshot still rebuilds identically
from the same dump. `readQuestWiki` joins each image with its credit, leaves out files marked
`missing`, and credits "EFT Wiki contributors" when there is no uploader. Under each group of
images the quest page shows "Images: <file name> by <uploader>; …, Escape from Tarkov Wiki, CC
BY-NC-SA" (and the enlarged view, the one image's line), linking each file page and the licence (`src/app/lib/wiki/wiki-images.ts` builds the URL and the
text). `next.config.mjs` traces `image-credits.json` into the quest pages.

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
applies the same cancellation and stale-data tracking as the route. Tool reads accept any
copy when tarkov.dev can't be reached, however old. Every result built from tarkov.dev data
carries `dataAsOf`, when the oldest data it used was last confirmed with tarkov.dev (or fetched
by the build), and results built from a copy whose refresh failed or was slow also carry a
`dataNotice` naming the copy (cached, or bundled with the server) and its age. `dataAsOf` and
`dataNotice` are left out of each tool's published output schema, which stays open, and
explained once in the server instructions.

Failed calls are tool errors (`isError`): a sentence, then the error object
`{ code, retryable, retryAfterSeconds? }` as JSON in a second text block and under
`_meta["eft-toolset/error"]`. It isn't `structuredContent`, because clients such as the
TypeScript SDK check that against the tool's output schema even on errors. Codes:
`upstream_unavailable` (retryable, with
`retryAfterSeconds`; only when the server has no copy of a dataset at all), `timeout`
(retryable with a narrower request), `invalid_input` and `internal_error` (not retryable).
`get_data_status` reports, per game mode and dataset, whether the instance holds a copy, its
source and age, its freshness target, and whether refreshing it is failing, with no request to
tarkov.dev; scheduled routines can check it before a run. `getGunPartLookup` projects every weapon and
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

The website needs no account; the MCP endpoint does. WorkOS AuthKit is the authorization
server, set by `MCP_AUTHKIT_DOMAIN` (`src/app/lib/mcp/auth.ts`). Production never serves the
endpoint without it: if the setting is missing there, every MCP request gets 503 and the error
is logged once per instance. In development an empty setting serves the endpoint without
sign-in, charging each IP's budget, so local tools and tests work without WorkOS.

- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`
  serve the protected resource metadata (RFC 9728), naming the AuthKit issuer. AuthKit runs
  the OAuth flow on its hosted pages, with PKCE, client registration (CIMD or DCR), sign-up,
  sign-in, and consent. The app has no login page, callback, or session of its own.
- Every request needs `Authorization: Bearer <token>`. The token is checked against
  AuthKit's JWKS: an asymmetric signature, the AuthKit issuer, the MCP URL
  (`MCP_RESOURCE_URL`) as audience, and expiry, with 30 seconds of clock tolerance. Agent
  tokens (`sub_profile: ai_agent`) are refused. If the keys can't be fetched the request gets
  503.
- A valid token's `sub`, the WorkOS user id, is the payer for rate limits and reaches tools
  as `ToolContext.userId`, the key for any per-user data. Tool results cached by arguments
  (`result-cache.ts`) are shared between users, so a tool that reads per-user data must not
  pass a `cacheKey`.
- Every tool in `tools/list` declares `securitySchemes` of `oauth2` (top-level and mirrored
  in `_meta`), which ChatGPT reads to know sign-in is required.
- Requests without a token, or with a bad one, are challenged rather than served, and
  challenges aren't rate limited, since they are what makes clients sign in or refresh.
  Clients disagree on how they want to be asked, so the challenge depends on the client:
  - Claude (claude.ai, Desktop, Claude Code), Cursor, VS Code, and any client not recognised
    get 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, as the MCP spec asks. That
    starts the client's OAuth flow, usually when the server is added.
  - ChatGPT's tool calls get a tool error (status 200) whose `_meta["mcp/www_authenticate"]`
    carries the challenge, which is the only thing that starts ChatGPT's sign-in during a
    tool call ([Apps SDK auth](https://developers.openai.com/apps-sdk/build/auth)). ChatGPT is
    recognised by the `openai/*` keys it puts in every tool call's `_meta`
    ([reference](https://developers.openai.com/apps-sdk/reference)) or by its `openai-mcp/`
    User-Agent. Its other requests get the 401.
  - Bad tokens get the same split with `error="invalid_token"`, which is what makes clients
    refresh them or sign in again.

  Detection reads the request itself, not `initialize`, because the endpoint is stateless and
  2026-07-28 clients may skip `initialize`. A client that fakes the markers only changes the
  shape of its own challenge.
- Signed-in users over their budget get 429, and so does anyone when the instance's global
  budget runs out.

Reading the body to shape a challenge is the one read a request without a valid token can
trigger; reads stay capped by size, time, and the MCP pool's concurrency limit.

### Website accounts

The website itself needs no account, but people need somewhere to see, sign out of, and
delete the account their AI assistants sign in with. The Settings page's Account section does
this with WorkOS's Node SDK (`src/app/lib/account/server.ts`), using the same WorkOS
environment as the MCP endpoint, so a person has the same user id in both. It's on when
`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD` are set.

Only these routes touch sessions, so every other page stays static and never reads cookies:

- `GET /auth/sign-in` (`?screen=sign-up` for the sign-up screen) stores a random state in an
  httpOnly cookie scoped to the callback and redirects to AuthKit's hosted sign-in.
- `GET /auth/callback` checks the state, exchanges the code for a session sealed with the
  cookie password, and sets it as the httpOnly `eft_session` cookie (30 days, SameSite=Lax).
- `GET /api/account` returns the user's email, name, and sign-up date, refreshing an expired
  access token once and rewriting the cookie. A session that can't be read or refreshed
  clears the cookies.
- `POST /api/account/sign-out` clears the cookies and returns AuthKit's logout URL, which
  ends the WorkOS session too. It answers with JSON for the page to follow, because the
  `form-action 'self'` policy blocks a form that redirects to another origin.
- `DELETE /api/account` deletes the user in WorkOS. Their assistants' tokens stop working
  once they expire, since refreshing needs the user.

Requests that change the account must come from the site's own pages (`Sec-Fetch-Site:
same-origin`, or a matching `Origin` where browsers don't send it). Account routes share the
website's per-client rate limit. Next to the session, a readable `eft_signed_in=1` cookie,
which holds nothing secret, lets the header show a signed-in account icon on static pages
without a request; the account API clears it whenever it finds no session.

Sign-in returns to the canonical site on the production deployment (`VERCEL_ENV=production`,
or a production build outside Vercel) and to the request's own origin on preview
deployments and in development, so each preview hostname completes its own sign-in.

In WorkOS, the environment needs `<site>/auth/callback` as a redirect URI (and
`http://localhost:3000/auth/callback` for development, plus a wildcard for preview hostnames
if previews should sign in), `<site>/settings` allowed as a sign-out redirect, and sign-up
enabled in AuthKit.

## Upstream resources

- Items, weapon structures, prices, presets: `/{gameMode}/items` and `_en`.
- Trader names: `/{gameMode}/traders` and `_en`.
- Task relations: `/{gameMode}/tasks` and `_en`.
- Barter and craft relations: `/{gameMode}/barters` and `/crafts`.
- Hideout station names: `/{gameMode}/hideout` and `_en`.
- Raid-planner data: `/{gameMode}/maps` and `_en`.

External requests have a 12-second timeout, a 32 MiB response-size guard, status and
shape validation, and a bounded resource allowlist. Upstream failures are translated to
a stable `UPSTREAM_UNAVAILABLE` response without exposing internals.

The datasets are large but compress well. Measured on 23 Nov 2026 (regular mode; PVE is the same
size):

| Dataset | JSON | Over the wire (brotli) | In the deployment snapshot | Changes |
| --- | --- | --- | --- | --- |
| `items` | 17.3 MB | 1.8 MB | 0.87 MB | every few minutes (prices) |
| `maps` | 9.0 MB | 0.80 MB | 0.50 MB | several times a day |
| `tasks` | 2.1 MB | 0.27 MB | 0.18 MB | several times a day |
| `items_en` | 1.7 MB | 0.49 MB | 0.35 MB | with game patches |
| the other eight | 0.77 MB | 0.13 MB | 0.12 MB | barters and traders daily, the rest with patches |

The adapter asks for brotli (Node's `fetch` asks only for gzip unless told), so loading `items`
downloads about 1.8 MB (1.9 MB gzipped), not 17 MB. Parsing it
takes about 100 ms and holds about 40 MB of heap per game mode.

**Freshness targets.** Prices about 2 minutes behind tarkov.dev with the [price feed](#price-feed) (5 minutes from `items` without it); tasks and maps about 30 minutes; trader,
barter, craft and hideout data and the English names 2 hours; the catalog itself (names, ids,
slots, stats) changes only with game patches. A copy older than its target is refreshed on its
next use, and served meanwhile up to the revalidate age in `RESOURCE_POLICIES`.

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
- A refresh of a copy makes one request: if it fails, the copy is served. A refresh for a caller
  with no copy at all asks again after quick failures (a reset connection, a 5xx, or a 429 asking
  for 2 seconds or less): at most 3 requests, 250 ms and 1 s apart with jitter. A timeout or a bad
  payload isn't asked again within the refresh.
- After a failed refresh, that dataset isn't requested again for 10 seconds, doubling to
  10 minutes, with jitter, or for as long as a `Retry-After` asks (up to an hour): about ten
  requests per dataset in the first hour of an outage. Meanwhile callers get the newest copy
  there is (see below); only a caller with no copy at all fails, at once and without a request,
  and the error carries the time left (`retryAfterMs`, the longest wait among the datasets it
  had no copy of).
- A caller whose copy is due waits for the refresh and takes the copy if it fails; while
  tarkov.dev is failing it doesn't wait at all. MCP tools wait at most 2.5 seconds
  (`staleWaitMs`), then take the copy and say it is stale, so tool calls stay fast when
  tarkov.dev is slow; once one has given up on a refresh, the next don't wait for it at all. Page renders wait out the refresh, so a slow tarkov.dev doesn't make them
  cache an older copy. A read takes copies up to six hours old by default
  (`RESOURCE_MAX_STALE_MS`); page renders keep that limit (a render that can't get data that new
  fails, and a background render keeps the previous page), while MCP tools and `/api/tarkov`
  accept any copy and say how old it is (`/api/tarkov` sends copies past six hours with
  `no-store`). A copy's age and source are recorded when a read takes it, so a refresh landing
  later in the read doesn't make its data look newer.

With the price feed on, items requests no longer grow with instances: only a CDN refill of the feed
reads the items file, at most once a minute per game mode. A refill lands on whichever instance the
CDN picks; that instance revalidates its copy, a 304 unless tarkov.dev has published since it last
looked. Per game mode, at 1, 100 and 10,000 MCP calls a minute (taking 1, 3 and 40 instances), that
is at most 60 items requests an hour (with one instance about 12 downloads and the rest 304s; with
many, most refills find an older copy, so up to 60 downloads), against about 12, 36 and 480
downloads before. How many distinct items are asked for makes no difference. Each instance gets the
feed from the CDN at most 60 times an hour (150–200 KB each), a game patch costs one items download
per instance, and while the feed is failing the numbers below apply.

Without the feed, the worst case for one instance, with every dataset in use in both game modes: items 24, maps
and tasks 8, `items_en` 1 request an hour, 33 an hour; maps, tasks and `items_en` are mostly
304s. The shared datasets add about 8 an hour per region, however many instances run. A new
instance revalidates the deployment snapshot instead of downloading it: datasets unchanged since
the build cost a 304, and only the ones that changed (in practice `items`, and `maps` or `tasks`
on some days) are downloaded, in the background when the caller already has the snapshot's copy.
While tarkov.dev is down, at most 3 requests per dataset per backoff interval.

### Deployment snapshot

`npm run build` runs `scripts/build-tarkov-snapshot.mjs` before `next build`. It fetches every
dataset in both game modes (four at a time, each tried up to 3 times, all within two minutes)
and writes each as brotli-compressed JSON to `data/tarkov/<mode>/`,
with `data/tarkov/manifest.json` recording when each was fetched and its `ETag` and
`Last-Modified` (about 4 MB in all; `data/tarkov` isn't committed). It then writes each mode's
[item index](#item-index) from those copies. `next.config.ts` traces it
into every function. A failure never fails the build: a dataset that can't be fetched keeps the
copy already on disk, if any, or is left out, and the app waits for tarkov.dev for it as before.
Pages prerendered during the build read the fresh snapshot, so the build itself barely asks
tarkov.dev for anything.

On an instance, a dataset with no copy in memory starts from the snapshot's copy
(`src/app/lib/api/tarkov-snapshot.ts`, read once per dataset, about 25 ms to decompress
`items`), dated when the build fetched it. If that is within the dataset's freshness it is used
as it is; otherwise it is revalidated with its `ETag` like any other copy. So a cold instance
answers at once, from the snapshot or after a 304, and when tarkov.dev is unreachable it still
answers, from the snapshot, saying how old it is. The snapshot ages with the deployment: every
deploy refreshes it, ISR renders don't.

### Item index

Search, item name matching, the category and caliber filters (`getItemCatalog`, `getItemFacets`), and
the `item.catalog` operation read a compact index instead of the items file, so `search_items`, the
name matching every item tool starts with, and the website's search never load the 17 MB file.
`scripts/item-index.mjs` derives it from `items` and `items_en`: each item's id, name, short name,
image, slug, types, handbook and item categories, and caliber, with the category trees and the
types and calibers stored once. It reproduces the projections they replaced exactly
(`tests/item-name-index.test.ts` checks every item against the old code on real data).

The snapshot build writes it as `data/tarkov/<mode>/item-index.json.br` (about 0.78 MB of JSON,
147 KB compressed, per mode), recording the `items` and `items_en` copies it came from;
`node scripts/build-tarkov-snapshot.mjs --index-only` rebuilds only the indexes from the copies on
disk. An instance reads it once per game mode (about 40 ms and 4.5 MB of heap, against about 210 ms
and 30 MB for parsing `items` and `items_en`). When the instance holds a newer `items` or
`items_en` copy than the index was built from (after a game patch, say), it derives the index from
those copies instead, once per pair of copies, with the same module. Without a bundled index (local
runs, tests, a failed snapshot) it is derived from the items file, loaded as before.

Names change only with game patches, so the index is a static input: like the static part of the
items file below, its age never makes a result stale or dated, and catalog responses keep their
usual CDN cache however old the deployment is.

### Price feed

tarkov.dev's items file mixes data that changes with game patches (names, stats, slots: most of its
17 MB) with prices, which its jobs rebuild every 5 minutes, so its ETag changes every few minutes.
Before, every instance downloaded the whole file (1.8 MB compressed) whenever its 5-minute freshness
ran out, however few prices it needed. Now the two parts travel apart:

- **Prices** come from the `price.feed` operation: every item's `lastLowPrice`, `avg24hPrice`,
  `low24hPrice`, `high24hPrice`, `lastOfferCount`, `changeLast48hPercent`, `updated`, and its trader
  buy and sell offers (`src/app/lib/api/price-feed.ts`). It is about 0.72 MB of JSON and 150–200 KB
  compressed per mode, a ninth of the items file. Its origin builds it from the items file, with a
  60-second freshness for this read alone (an ETag revalidation, a 304 unless tarkov.dev has
  changed it), waiting up to 5 seconds for it before serving its copy marked stale. Responses carry
  when the origin last confirmed the copy, its source, whether it was stale, and its ETag, and are
  cached at the CDN with `public, max-age=0, s-maxage=60, stale-while-revalidate=60` (30 seconds for
  a stale copy; never past the six-hour ceiling).
- **Static data** comes from the items copy the instance already has, the deployment snapshot or a
  newer copy, which is not refreshed for its prices. `loadItems` lays the feed's prices over it,
  once per pair of copies (about 10 ms and 3 MB), so every projection (MCP tools, pages,
  `/api/tarkov`, the gun builder's part lookup) gets the feed's prices unchanged.

Each instance keeps its own copy of the feed per game mode, fetched from the site's own public origin
through the CDN: fresh for 60 seconds, served while it refreshes for up to 2 minutes, and after that
read with the caller's usual wait (MCP tools 2.5 s, then the copy marked stale). Callers share one
refresh in flight. A failed fetch isn't retried for 10 seconds, doubling to 10 minutes with jitter,
or for as long as a `Retry-After` asks (up to an hour); meanwhile reads use the items file at once.
Responses are validated (format version, sizes, every field) and capped at 8 MiB, with a 10-second
timeout and the usual User-Agent. The origin is `SITE_ORIGIN` in production and the deployment's own
URL on previews, sending `x-vercel-protection-bypass` when Vercel provides
`VERCEL_AUTOMATION_BYPASS_SECRET`. Locally the feed is off unless `PRICE_FEED_ORIGIN` names an origin
(ignored on Vercel), and it is off during `next build`; off, everything works as it did before the feed.

Fallbacks, in order: the instance's copy of the feed; a refresh through the CDN; then, while the feed
is failing (or a preview's protection refuses it), the items file read exactly as before (the copy in
memory, a revalidation with json.tarkov.dev, or the deployment snapshot), with the feed's last prices
laid over it if they are newer. Because the static copy isn't refreshed while the feed works, it can
be older than a page render's six-hour limit when the feed starts failing; while the feed's last
prices are within it, a read uses them, marked stale, and the items file is fetched in the
background. On a cold instance whose first feed fetch is slow, the snapshot's own prices are used,
marked stale. A read never fails while any copy exists. A refresh that brings the same items file
(the same ETag) keeps the instance's copy and only notes when it was confirmed, so projections and
cached tool results built from it stay valid until tarkov.dev publishes new prices. `price.feed` is
served over GET only, and the feed is fetched without following redirects.

The feed lists every item tarkov.dev has, so items the static copy lacks mean a game patch: the
instance then loads the items file once, in the background, and the item index follows it.

How far prices lag tarkov.dev's file: the origin's copy up to 60 s, the CDN up to 120 s with
stale-while-revalidate, an instance's copy up to 120 s; under steady traffic at most about 3 minutes
and typically about 90 seconds, against up to 35 minutes before (5 minutes fresh, then served while
refreshing for up to 30). `dataAsOf` is the origin's confirmation time, so it includes every hop.

**Why one feed for every item.** tarkov.dev only offers whole JSON files: there is no per-item
current-price endpoint (`/{mode}/prices/{id}` is the price history). One feed carries every price, so the number of distinct items asked for doesn't
change the upstream cost, and a CDN cache shared by every instance does what a per-item cache would.

**Why the CDN and not a shared server cache.** Vercel's Runtime Cache (used for the small datasets
under Cache ownership) caps items at 2 MB and bills writes per 8 KB: one feed per mode per change
would be about 160 units a write, far beyond the Hobby allowance. The CDN caches the GET for free
within the plan's edge requests, and keys on the URL like every other public read.

### Data paths by tool

| Tool or page | Item index | Price feed | Static items copy | Bulk datasets |
| --- | --- | --- | --- | --- |
| `search_items`, item name matching, `item.catalog` | yes | | | |
| `get_item`, `item.detail` | yes | yes | yes | tasks, barters, crafts, hideout, traders |
| `get_item_prices`, `item.group`, keys pages | yes | yes | yes | tasks, hideout, traders |
| Gun builder tools, `optimize_build`, best and Gunsmith builds | | yes | yes | tasks, traders, barters (when asked) |
| `get_map_details`, raid plans, map pages | | | | maps |
| Quests | | yes (item prices) | yes | tasks, maps |
| Market board, item prices page, ammo | | yes | yes | traders, tasks |
| `get_data_status`, `get_wiki_page`, `lookup_term` | | | | |

Only the feed's origin, behind the CDN, downloads the items file on a timer; everything else reads
the copy it has for static data. "Bulk datasets" are the other tarkov.dev files, unchanged.

## Cache ownership

- The server resource cache amortizes large upstream downloads and JSON parsing. With the price
  feed on, the items copy is read only for its static data and isn't refreshed on a timer (see
  [Price feed](#price-feed)). Each other resource is fresh for its policy's time, then revalidated in the background without
  blocking requests (items for up to 30 minutes, maps and tasks 2 hours, the rest 4 hours),
  and served stale (flagged with `X-EFT-Data-Stale`) when a refresh fails. It starts from the
  deployment snapshot (see above).
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
- The CDN shares one copy of the price feed among every instance, refreshed at most once a
  minute per game mode.
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
