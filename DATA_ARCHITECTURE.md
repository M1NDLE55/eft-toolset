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
  -> POST /api/tarkov
  -> validated operation allowlist
  -> cached json.tarkov.dev resources
  -> localization, ID joins, and narrow projection
  -> feature-specific response
```

The upstream JSON resources are intentionally broad. At the time of migration, the
regular item payload was about 15.8 MB and the map payload about 9.6 MB. They are fetched
server-side, cached for five minutes in-process and through Next's data cache, and never
forwarded wholesale to a browser.

## Operations

| Operation | Inputs | Result |
| --- | --- | --- |
| `item.catalog` | `gameMode` | Search/catalog item projection |
| `item.group` | `gameMode`, up to 100 names | Item-group prices and task names |
| `item.detail` | `gameMode`, item name | Item, tasks, barters, and crafts |
| `gun.list` | `gameMode` | Weapon-picker rows |
| `gun.build-items` | `gameMode`, up to 100 IDs | Complete build nodes |
| `gun.pick-items` | `gameMode`, up to 100 IDs | Lightweight slot-picker rows |
| `gun.preset` | `gameMode`, preset ID | Base item and contained IDs |
| `map.details` | `gameMode`, normalized map key | One joined map projection |

Operation names live in `src/app/lib/api/operations.ts`. The route rejects unknown
operations, invalid game modes, oversized batches, and request bodies over 64 KiB. It
does not accept an upstream URL, resource name, field selection, or arbitrary query.

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

- The server resource cache amortizes large upstream downloads and JSON parsing.
- Next's fetch cache revalidates source resources every five minutes.
- The client query layer deduplicates concurrent requests and controls stale/max ages.
- IndexedDB holds validated query projections for fast reloads and offline-tolerant stale
  data. Query schema-version bumps invalidate incompatible projections.
- Gun-builder entries keep their existing per-ID TTL envelopes so opening one slot does
  not refetch an entire build tree.

## Adding a query

Add a constant to the operation allowlist, validate its exact variables in the server
dispatcher, build a narrow response projector, and call it through `apiFetch`. Add fixture
coverage for joins/localization and a live smoke check against both game modes when the
upstream shape changes. Do not expose generic resource paths or restore arbitrary query
text to the browser.

References: [Tarkov.dev API documentation](https://tarkov.dev/api/) and the
[machine-readable endpoint list](https://json.tarkov.dev/endpoints).
