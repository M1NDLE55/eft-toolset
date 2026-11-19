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
| `market.board` | `gameMode` | Top 48-hour flea movers and best sell value per slot |
| `quest.list` | `gameMode` | Every quest with its requirements and item needs, and the items and maps they name |

Operation names live in `src/app/lib/api/operations.ts`. The route rejects unknown
operations, undeclared variables, invalid game modes, oversized batches, request bodies
over 64 KiB, slow bodies, and URLs over 2 KiB. It does not accept an upstream URL,
resource name, field selection, or arbitrary query.

`item.catalog`, `item.detail`, `gun.list`, `gun.preset`, `map.details`, `market.board`, and `quest.list` are also served
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
instead. Crawlers (Next's `userAgent().isBot`) get 9 seconds, and if the item still isn't
available they get a 500 so they retry later, rather than indexing an empty page. Item
pages are never marked `noindex` for a temporary failure. Every item slug is listed in the
sitemap.

An item page is a grid of cards (`src/app/components/item/cards.tsx`), laid out by a view:
Raid, Standard and Full are built in, each showing everything the one before does and more,
and visitors can copy one into their own view to reorder, resize, add and remove cards.
Views are kept in local storage (`src/app/lib/item-views/store.ts`) and included in backups.
The active view is mirrored in the `eft-item-view` cookie (a preset's id, or a custom view's
id and cards), so the server renders the page as the visitor will see it; crawlers get
Standard. Besides prices and uses, `item.detail` returns the item's description, weight,
category, flea statistics, and the barters and crafts that give it.

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
builds can't be worked out in time, crawlers get a 500 to retry and visitors a short notice.
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
  no such link are listed apart under it as standalone quests. Quests that share a name and
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

All three render with the visitor's game mode (PVE for the PVE page) and fall back like the
other pages: crawlers get a 500 to retry, and visitors a short notice.

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
raid. An image goes under an objective when its subsection or caption (or failing those, its file
name) names a map only one of them is on, or several are and the caption's words appear in only
one's description; when it names no map but its caption's words appear in only one description;
when it follows, in the same part of the page, an image that went under an objective and its words
don't point at another; or when it's in the guide and only one objective is on a map. The rest go
in a strip right under the objectives, labelled by subsection (or by section, outside the guide).
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
