# Usage stats

EFT Toolset records anonymous usage events: which features, tools, weapons, maps and items people
use, how often, and whether from the website or from AI agents over MCP. They are stored in
Cloudflare Workers Analytics Engine and read on the admin page `/admin/stats` and through a daily
summary endpoint. The code is in `src/app/lib/usage/`; the tests are in `tests/usage-stats.test.ts`.

## What is never collected

- No user ids, email addresses, names, IP addresses or user agents.
- No cookies or local storage of its own, and no fingerprinting.
- No text anyone typed: no search strings, item or plan names, notes, share links or URLs.

This is enforced by construction, not by care at each call site:

- An event is a name from the catalogue below plus a few fields, each from a closed list (game
  mode, outcome, duration bucket, MCP tool name, route pattern) or a game id checked against its
  format (a 24-character tarkov.dev id, or a map key from the map list). `checkedEvent` in
  `record.ts` refuses anything else, including any extra field.
- Rows are built column by column from those fields (`usageDataPoint`); there is no column for
  anything else.
- MCP tools report the id they *resolved* (`noteSubject`), never the caller's argument. Text that
  isn't an id is dropped and the call is still counted.
- Pages are named by their route pattern (`/item/$itemName`), never their URL.
- The country is Cloudflare's two-letter `request.cf.country`, never sent by the client.

## Anonymous daily and weekly ids

To count unique visitors and actions per visitor, each row carries two ids made the way Plausible
does it: `HMAC-SHA-256(key, subject)`, cut to 64 bits, where the subject is the WorkOS user id when
signed in (so an account counts once across the website and every AI agent) and otherwise the IP
address and user agent. There is one random key per UTC day and one per ISO week. The keys live only
in the `UsageSaltDO` Durable Object: asking for the current key deletes every older one, and an alarm
at the end of each UTC day deletes it even if no event arrives. Once a key is gone nobody can work out
which subject an id stood for, and the next day's id is unrelated. Keys are never logged; isolates
hold them only as non-extractable signing keys. A `signed_in` column says whether the id came from an
account.

## Opting out

The browser sends nothing when Global Privacy Control (`navigator.globalPrivacyControl`) or Do Not
Track is on. The endpoint also drops beacons carrying `Sec-GPC: 1` or `DNT: 1`. Server-side events
(MCP tool calls, sign-ins) carry no browser signal and are recorded for everyone, anonymously.

## Event catalogue

The source of truth is `USAGE_EVENTS` in `src/app/lib/usage/catalog.ts`.

| Event | Source | Feature | Fields | Recorded when |
| --- | --- | --- | --- | --- |
| `mcp.tool_call` | mcp | mcp | tool, weapon/item/map id, game mode, outcome, duration | Every MCP tool call (`runTool`) |
| `account.sign_in` | server | account | outcome | Website sign-in finishes or fails |
| `account.delete` | server | account | outcome | An account is deleted |
| `link.create` | server | sharing | | A view, copy or invite link is made on the website |
| `link.copy` | server | sharing | | Something is copied into an account from a link (also after signing in to copy) |
| `link.join` | server | sharing | | An invite adds a new member to a raid plan (not a repeat accept) |
| `plan.host` | server | sharing | map id | A raid plan is created in an account, hosted live |
| `report.file` | server | sharing | | Shared content is reported (never the reason's text) |
| `page.view` | web | site | route pattern | Each page navigation |
| `page.error` | web | site | route pattern | A page shows the error screen |
| `build.create` | web | gun-builder | weapon id, game mode | A build is created from the weapon picker |
| `build.optimize` | web | gun-builder | weapon id, game mode, outcome, duration | The optimiser finishes or fails |
| `build.share` | web | gun-builder | weapon id | A build's share link is copied or shared |
| `build.import` | web | gun-builder | weapon id | A shared or imported build is saved |
| `plan.create` | web | raid-planner | map key | A raid plan is created or a shared one imported |
| `plan.open` | web | raid-planner | map key | A raid plan is opened in the editor |
| `plan.share` | web | raid-planner | map key | A plan's share link is copied or shared |
| `map.view` | web | raid-planner | map key | An interactive map is opened |
| `group.create` | web | item-groups | | An item group is created |
| `group.copy_list` | web | item-groups | game mode | A group's price list is copied |
| `item.view` | web | item-scanner | item id, game mode | An item page shows an item |
| `quest.complete` | web | quests | | A quest is marked complete |
| `data.export` | web | data | | A backup is downloaded |
| `data.import` | web | data | outcome | A backup is restored |
| `mode.switch` | web | game-mode | game mode | The PVP/PVE switch is used |
| `mcp.setup_copy` | web | mcp | | An MCP setup snippet is copied |

The sharing events count website requests only; the same actions over MCP (`share_link`,
`copy_from_link`, `join_raid_plan`, `report_content`) are counted once, as `mcp.tool_call`.

Field values: game mode `regular` or `pve`; outcome `ok`, `error`, `cancelled`, `input_error`,
`upstream_error`, `timeout`, `crash` or `refused` (an MCP call the account's library or plan turned
down: not allowed, over a limit, or an edit conflict); duration `<100ms`, `100ms-1s`, `1-5s`, `5-20s` or `20s+`.

Adding an event: add it to `USAGE_EVENTS` with the fields it may carry, call `trackUsage` (browser)
or `recordUsage` (server), and add a row here. A new page route also needs adding to `USAGE_ROUTES`;
a test fails until it is.

## Storage layout

One dataset, `eft_toolset_usage` (binding `USAGE`). `index1` is the event name: Analytics Engine
samples per index value, so a low-cardinality index keeps rare events while common ones are sampled.

| Column | Holds |
| --- | --- |
| `blob1` | event |
| `blob2` | source: `web`, `mcp` or `server` |
| `blob3` | feature |
| `blob4` | MCP tool name |
| `blob5`, `blob6` | subject kind (`weapon`, `item`, `map`) and id |
| `blob7` | game mode |
| `blob8` | outcome |
| `blob9` | duration bucket |
| `blob10` | country |
| `blob11` | layout version (`1`) |
| `blob12`, `blob13` | anonymous daily and weekly ids |
| `blob14` | signed in: `1`, `0`, or empty when unknown |
| `blob15` | route pattern |

Counts use `SUM(_sample_interval)`, which stays right under sampling. Unique counts use
`count(DISTINCT blob12)`, which is exact while nothing is sampled and slightly low if Analytics
Engine ever samples (it samples only at volumes far beyond this site's). Rows are kept for three
months (https://developers.cloudflare.com/analytics/analytics-engine/limits/).

## Endpoints

- `POST /api/usage`: one website event, sent by `navigator.sendBeacon` (`track.ts`). Same-origin
  only (403 otherwise), at most 512 bytes, strictly validated (400), rate limited per IP in each
  isolate (a burst of 60, then one every two seconds), per IP across isolates (`WEB_IP_LIMITER`) and
  per isolate overall (429). Answers 204 with no body. The IP is used for the rate limit and the
  hashed id only.
- `GET /api/admin/stats?days=7|30|90`: the dashboard's data. Needs a website session whose WorkOS
  user id is in `STATS_ADMIN_USER_IDS` (401 signed out, 403 not listed, 404 when the list is empty).
- `GET /api/admin/stats/daily?date=YYYY-MM-DD` (default yesterday, UTC): one day's summary for
  scripts. Needs `Authorization: Bearer <STATS_READ_TOKEN>`, compared in constant time (401
  otherwise, 404 when the token isn't set). Returns visitors (signed in and out), page views, active
  accounts, new and total accounts, events, the web/MCP/server split, top features, pages, MCP tools,
  weapons, maps and items, errors by MCP tool and by page, and a spike check (value, seven-day
  average, ratio, flag) for visitors, page views, events, MCP calls and errors. A spike is at least
  twice the average and at least 20 more.

Both readers are read-only, rate limited per IP (a burst of 20, then one every five seconds) and
across isolates, and cache each answer for five minutes per isolate. Account totals come from
WorkOS's user list (creation dates only, counted at most hourly) and are never joined to events.

## Setting it up

1. Deploy: the binding and the Durable Object migration are in `wrangler.jsonc`; events start
   flowing with no other setup.
2. Create a Cloudflare API token with only **Account › Account Analytics › Read** for this account,
   then `wrangler secret put STATS_CF_API_TOKEN` and `wrangler secret put STATS_CF_ACCOUNT_ID`.
3. `wrangler secret put STATS_ADMIN_USER_IDS` with your WorkOS user id(s), comma separated.
4. For the daily summary, `wrangler secret put STATS_READ_TOKEN` with a random value of 32+
   characters (for example `openssl rand -hex 32`).

Pricing for Analytics Engine writes and SQL API reads is at
https://developers.cloudflare.com/analytics/analytics-engine/pricing/. Each event is one row; a
dashboard load is nine queries and a daily summary five, each cached for five minutes.

## Local development

Analytics Engine can't be queried locally. `scripts/usage-sql-mock.mjs` stands in for the SQL API:
it runs a command, collects the rows the Worker logs when `USAGE_LOG_EVENTS=1`, and answers the
queries `stats.ts` sends from them (only those; it is not a SQL engine).

```bash
npm run build
node scripts/usage-sql-mock.mjs --port 8790 -- npx wrangler dev --config dist/server/wrangler.json \
  --var USAGE_LOG_EVENTS:1 --var USAGE_SQL_API_URL:http://127.0.0.1:8790/sql \
  --var STATS_READ_TOKEN:<32+ characters>
```

`USAGE_SQL_API_URL` is honoured only for localhost. `npm run dev` logs rows without the setting.
