# EFT Toolset

Fast, free tools for Escape From Tarkov players, built on live [tarkov.dev](https://tarkov.dev) data for both PVP and PVE. Everything you create is saved in your browser and can be shared by link. Live at [eft-toolset.com](https://www.eft-toolset.com).

## Tools

### Item Scanner
Look up any item for trader and flea prices, the best place to sell it (flea price after the listing fee), value per slot, and every task, barter, and craft that uses it. Search ranks results by name and short name; press `/` anywhere to search. Item pages render on the server at readable URLs such as `/item/salewa-first-aid-kit`, and the prices you have seen are kept so the page can show how they changed since your last visit.

### Item Groups
Build watchlists of loot with live best-sell prices, value per slot, totals, and changes since your last visit. Add items straight from search, sort by price or value per slot, and copy a group as a price list ready to paste into Discord.

### Gun Builder
Assemble weapons part by part with compatible slots, factory presets, and live ergonomics, recoil, weight, and cost. It includes:
- an optimiser for ergonomics, recoil, or cost, with an optional budget;
- an ammo picker that adds the ammo's recoil to the build's stats;
- one-click cheapest parts for empty required slots;
- side-by-side build comparison and a printable or copyable shopping list;
- undo, keyboard navigation, and share links that others can import by pasting.

### Raid Planner
Plan raids on interactive maps, including Icebreaker and its decks. Draw routes, arrows, waypoints, and notes on each level, measure distances, and toggle extracts, transits, spawns, locks, hazards, and loot layers. Plans support undo and redo, show their total route distance, and can be shared by link or exported to a file.

## Also included

- **PVP and PVE:** one switch in the header changes every price and data set.
- **Backup and restore:** export all your groups, builds, plans, and settings to one file from `/data`, then restore them by merging or replacing.
- **Offline use:** pages and data you have visited keep working without a connection.
- **Phone friendly:** every tool is designed for both desktop and mobile.

## How it works

The app uses tarkov.dev's JSON API through a server-side adapter that accepts only a fixed set of operations, caches the large upstream datasets with background revalidation, and returns just the data each screen needs. Public reads are cacheable at the edge, and the browser keeps results in IndexedDB for instant repeat visits. See [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md) for the data flow, operations, caching, and rate limiting.

Built with Next.js 16 (App Router), React 19 with the React Compiler, Tailwind CSS 4, Leaflet, and Vitest.

## Development

Requires Node.js 20.9 or newer.

```bash
git clone https://github.com/M1NDLE55/eft-toolset.git
cd eft-toolset
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server on http://localhost:3000 |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint, including the React Compiler rules |
| `npm test` | Run the Vitest suite |
| `node scripts/generate-maps-config.mjs` | Regenerate the raid planner's map configuration from tarkov.dev after a game update |

### Environment variables

All are optional.

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_WEB_ANALYTICS_TOKEN` | Enables Cloudflare Web Analytics |
| `CLIENT_IP_HEADER` | The header your proxy sets with the real client IP, used for API rate limiting. On Vercel, `X-Real-IP` is used automatically. |
| `WARM_TARKOV_CACHE` | Set to `0` to skip preloading tarkov.dev data when the server starts |

## License

Licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.

## Contact

For bugs, suggestions, or questions, please [open an issue](https://github.com/M1NDLE55/eft-toolset/issues).
