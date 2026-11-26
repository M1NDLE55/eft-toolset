# EFT Toolset

Fast, free tools for Escape From Tarkov players, built on live [tarkov.dev](https://tarkov.dev) data for both PVP and PVE. Everything you create is saved in your browser and can be shared by link. Live at [eft-toolset.com](https://www.eft-toolset.com).

## Tools

### Item Scanner
Look up any item for trader and flea prices, the best place to sell it (flea price after the listing fee), value per slot, and every task, barter, and craft that uses it. Search ranks results by name and short name; press `/` anywhere to search. Item pages render on the server at readable URLs such as `/item/salewa-first-aid-kit`, and the prices you have seen are kept so the page can show how they changed since your last visit. `/flea-market/pve` lists the most valuable PVE loot, `/ammo` charts every round by calibre, and `/keys` lists every key by map with its price and quest uses.

### Item Groups
Build watchlists of loot with live best-sell prices, value per slot, totals, and changes since your last visit. Add items straight from search, sort by price or value per slot, and copy a group as a price list ready to paste into Discord.

### Gun Builder
Assemble weapons part by part with compatible slots, factory presets, and live ergonomics, recoil, weight, and cost. It includes:
- an optimiser for ergonomics, recoil, or cost, with an optional budget;
- an ammo picker that adds the ammo's recoil to the build's stats;
- one-click cheapest parts for empty required slots;
- side-by-side build comparison and a printable or copyable shopping list;
- undo, keyboard navigation, and share links that others can import by pasting.

Best-build pages at `/gun-builder/best` show the lowest recoil and max ergonomics build for every weapon, next to its factory preset, with every part and live prices. Gunsmith pages at `/gun-builder/gunsmith` give a ready build for every Gunsmith task, checked against its requirements.

### Raid Planner
Plan raids on interactive maps, including Icebreaker and its decks. Draw routes, arrows, waypoints, and notes on each level, measure distances, and toggle extracts, transits, spawns, locks, hazards, and loot layers. Plans support undo and redo, show their total route distance, and can be shared by link or exported to a file.

### AI assistants (MCP)
Every tool is also available to Claude and other AI assistants through a public [Model Context Protocol](https://modelcontextprotocol.io) server at `https://www.eft-toolset.com/api/mcp`. Assistants get the same live data and calculations as the app: item lookups and loot pricing, weapon builds that they can modify part by part, optimise, and compare, and raid plans drawn from named extracts and spawns. `lookup_term` explains player jargon (callouts like Big Red, nicknames like LEDX or M995, slang like FIR) and links it to the real items and map positions, and `get_wiki_page` reads a snapshot of the community [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com/wiki/Escape_from_Tarkov_Wiki) for what tarkov.dev doesn't cover, such as boss behaviour, extract conditions, and quest guides. Builds and plans come back as share links that open in the app, and `create_import_link` bundles item groups, builds, and plans into one import link that opens `/data` ready to merge. Connection steps for each client are on the [`/mcp`](https://www.eft-toolset.com/mcp) page; for Claude Code:

```bash
claude mcp add --transport http eft-toolset https://www.eft-toolset.com/api/mcp
```

## Also included

- **PVP and PVE:** one switch in the header changes every price and data set.
- **Settings:** choose the home screen you want at `/settings`: a dashboard of your own items, builds, plans and watchlists (the default), a search-first page, a flea market board, or a maps-first page.
- **Backup and restore:** export all your groups, builds, plans, and settings to one file from `/data`, then restore them by merging or replacing.
- **Offline use:** pages and data you have visited keep working without a connection.
- **Phone friendly:** every tool is designed for both desktop and mobile.

## How it works

The app uses tarkov.dev's JSON API through a server-side adapter that accepts only a fixed set of operations, caches the large upstream datasets with background revalidation, and returns just the data each screen needs. Public reads are cacheable at the edge, and the browser keeps results in IndexedDB for instant repeat visits. See [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md) for the data flow, operations, caching, and rate limiting.

The MCP endpoint reuses the same adapter and the app's own gun-builder and raid-planner logic, so assistants and the app always agree.

Built with [TanStack Start](https://tanstack.com/start) on [Cloudflare Workers](https://developers.cloudflare.com/workers/), React 19 with the React Compiler, Tailwind CSS 4, Leaflet, Cloudflare's Agents SDK and the MCP TypeScript SDK, and Vitest. Pages are cached at the edge, per-user state lives in Durable Objects, and a Durable Object refreshes the shared tarkov.dev data on demand and pushes new prices to open pages. [`DEPLOYMENT.md`](DEPLOYMENT.md) covers the Cloudflare setup.

## Development

Requires Node.js 22 or newer.

```bash
git clone https://github.com/M1NDLE55/eft-toolset.git
cd eft-toolset
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server on http://localhost:3000, running the Worker in workerd with local bindings |
| `npm run build` | Fetch the tarkov.dev snapshot, then build the client, the Worker and the prerendered pages into `dist/` |
| `npx wrangler dev --config dist/server/wrangler.json` | Serve the production build locally |
| `node scripts/refresh-sim.mjs` | After a build: watch the refresher against a stand-in tarkov.dev on a schedule you control, with sped-up clocks |
| `npm run lint` | Run ESLint, including the React Compiler rules |
| `npm run typecheck` | Generate the Worker's binding types and type-check everything |
| `npm test` | Run the Vitest suite |
| `node scripts/parity.mjs --baseline <origin> --candidate <origin> --token <token>` | Compare two deployments' pages and MCP tools (see the script's header) |
| `node scripts/mcp-client-check.mjs --url <mcp url> --token <token>` | Connect real MCP clients (SDK v1 and v2), list tools and call them |
| `node scripts/generate-maps-config.mjs` | Regenerate the raid planner's map configuration from tarkov.dev after a game update |
| `node scripts/build-glossary.mjs` | Resolve the glossary's landmark positions and item ids against live data after editing `src/app/lib/glossary/terms.json` |
| `node scripts/build-wiki-snapshot.mjs` | Rebuild `data/wiki` from the wiki's published XML dump (`--check` only reports whether a newer dump is out; `--file` uses a downloaded one) |

### Settings

All are optional locally. Put them in `.dev.vars` (see [`.dev.vars.example`](.dev.vars.example)); production sets them in `wrangler.jsonc` and as secrets (see [`DEPLOYMENT.md`](DEPLOYMENT.md)).

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_WEB_ANALYTICS_TOKEN` | Enables Cloudflare Web Analytics |
| `MCP_AUTHKIT_DOMAIN` | The WorkOS AuthKit domain that MCP users sign in with. Required in production: without it the MCP endpoint stays closed there. In development, leaving it empty serves the endpoint without sign-in. See [MCP sign-in](DATA_ARCHITECTURE.md#mcp-sign-in). |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` | Website sign-in on the Settings page, where people manage or delete the account their AI assistants use. Use the same WorkOS environment as `MCP_AUTHKIT_DOMAIN`. The cookie password encrypts the session cookie and must be at least 32 characters. Without all three, the Settings page says accounts aren't set up. See [Website accounts](DATA_ARCHITECTURE.md#website-accounts). |
| `APP_ORIGIN` | Where sign-in returns to on a deployment that isn't www.eft-toolset.com (a `workers.dev` test deploy, say) |
| `MCP_RESOURCE_URL` | The MCP endpoint's public URL that access tokens must be issued for. Defaults to `https://www.eft-toolset.com/api/mcp`. |
| `MCP_USER_RATE_BURST`, `MCP_USER_RATE_PER_SECOND` | Each user's MCP budget (default 160 tokens, refilling 3 per second), kept in their Durable Object |
| `TARKOV_UPSTREAM_URL` | A stand-in for json.tarkov.dev, for local load and parity tests (`scripts/mcp-load.mjs --serve-only`) |


EFT Toolset is built on other people's work. The site's [`/credits`](https://www.eft-toolset.com/credits) page lists the same sources and how we use them.

- **[tarkov.dev](https://tarkov.dev)** by [The Hideout](https://github.com/the-hideout): item, price, trader, quest, and map data from the free [tarkov.dev API](https://tarkov.dev/api/), and the raid planner's map setup from tarkov.dev's [`maps.json`](https://github.com/the-hideout/tarkov-dev/blob/main/src/data/maps.json). Item images, map tiles, and map SVGs load from `assets.tarkov.dev`. The server caches every dataset and the API is rate-limited (see [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md)).
- **SVG maps by Shebuka**: the raid planner's Streets of Tarkov, Interchange, Lighthouse, Shoreline, and Terminal maps come from [tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). They're shown unmodified apart from floor visibility, and the planner credits them on the map.
- **Map tiles** from `assets.tarkov.dev`, credited on each map as tarkov.dev lists them: Shebuka (Ground Zero, Customs, Factory, Reserve, Woods), [TarkovBOT.eu](https://tarkovbot.eu/) (Icebreaker), and tarkov.dev (The Lab, The Labyrinth).
- **[Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com/wiki/Escape_from_Tarkov_Wiki)** on Fandom, written by its contributors and licensed [CC BY-NC-SA](https://www.fandom.com/licensing). `get_wiki_page` adapts pages to plain text and the glossary's meanings are mostly written from wiki pages; every wiki result carries a credit line to keep with the text, and every glossary entry links its source. The tool reads a snapshot built from the wiki's published XML dump (the dump's date and checksum are in [`data/wiki/manifest.json`](data/wiki/manifest.json); currently 2026-11-12) and makes no requests to the wiki. Quest pages show the wiki's map and location pictures, loaded by the visitor's browser from the wiki's image host, each credited with its uploader (from the wiki's API, recorded in [`data/wiki/image-credits.json`](data/wiki/image-credits.json)), the wiki, and the licence.
- **Other glossary sources**: a few entries cite [Tarkov Forge](https://tarkovforge.com/), Reddit threads, or [Game Rant](https://gamerant.com/).
- **[Battlestate Games](https://www.battlestategames.com/)**: Escape from Tarkov, its names, images, and game data belong to Battlestate Games. This is an unofficial fan project.
- **Software and fonts**: [TanStack Start](https://tanstack.com/start) and [React](https://react.dev/) (MIT), [Leaflet](https://leafletjs.com/) (BSD-2-Clause), [Radix UI](https://www.radix-ui.com/) (MIT), [Lucide](https://lucide.dev/) icons (ISC), and the [Inter](https://rsms.me/inter/) font (SIL Open Font License).

## License

Licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.

The GPL covers this project's code only. The wiki text and the SVG maps listed under [Credits](#credits) are licensed CC BY-NC-SA, which allows **non-commercial use only**, so monetising this service (ads, paid tiers, sponsorships) would mean removing or rethinking the wiki tool and those maps first.

## Contact

For bugs, suggestions, or questions, please [open an issue](https://github.com/M1NDLE55/eft-toolset/issues).
