# Bible games

Group Bible games for a room: a shared screen (the leader's laptop or a projector) and every player's phone as
the controller. Nine games (fill in the blank, name that reference, sword drill, who said it, who am I, put in
order, category board, detective, describe it), a solo mode, a leader/controller handover and teams. Web only;
the desktop app does not have it (like the desktop Presenter).

The app came from the stand-alone `bible-games` repository (task 0115). It is a built-in feature module,
`games`, built per `packages/core/docs/features/feature-modules-migration.md`. Switching the module off
(`kth.modules = '-games'` in a dev build, or the server reporting it off) removes the app, its tile, its
strings and its routes.

## Where things are

| Piece | Path |
|---|---|
| Manifest, binding (entry-chunk code), module code, live-badge sink | `apps/web/src/modules/games/{manifest,binding,module,runtime}.ts` |
| Host screen, the lazy `#/@games` app | `apps/web/src/modules/games/app/GamesApp.tsx` |
| The games' own client (Preact): shell, nine games, clock | `apps/web/src/modules/games/client/` |
| Wire protocol, scoring helpers, themes (used by both sides) | `apps/web/src/modules/games/shared/` |
| Phone page entry | `apps/web/games/play.html` -> `src/modules/games/client/main.tsx` |
| Server: room reducer, transport (SSE), games, judge, content layer | `apps/web/server/modules/games/` |
| Authored content (curated verses, prompt cards, generator facts) | `apps/web/server/modules/games/content-src/` |
| Locale strings (app shell only) | `apps/web/src/locales/<lng>/games.json` |

## How it fits the app

- **Host screen**: `#/@games` is a lazy app (`keepAlive: while-busy`). Its router is in memory, because the
  address bar belongs to the reader. While a room is open the app is busy and shows a "live" dot on the rail.
  Its styles are all under `.games-root`; the colour tokens fall back to the reader's `--kth-*` tokens, so it
  follows the reader's theme until a room or a device picks a theme of its own (those are written on the games
  root element only).
- **Phones**: `/games/play?room=CODE` is a second HTML entry, like the Presenter's viewer. It loads the games
  client and nothing of the reader (no stores, plugin host, i18n catalogue). `scripts/check-entry-chunk.mjs`
  fails the build if the reading entry statically pulls in Games code or the phone page pulls in reader code.
  `/games/screen` (a second display, keyed by a display token) and `/games/solo` serve the same page.
- **Server**: the module's routers mount through `routeRegistry` under `/api/games`
  (`POST rooms`, `GET rooms/:code/stream` (SSE), `POST rooms/:code/intent`, `POST time`, `GET catalog`), the pages
  under `/games`. Rate limiting has its own tier, `games` (3000 requests a minute per address, because a room's
  phones share one). The CSP needs no change: the games use same-origin SSE and fetch, inline styles and no
  third-party origin.
- **Verse text** comes from the host's `DatabaseManager` (`DatabaseManagerCatalog`): the installed Bibles, the
  site's visibility settings, text exactly as stored. A translation is read once into memory when a game first
  asks for it.
- **Content database**: the questions, sets, prompt cards and curated verse tiers live in
  `<state dir>/games/content.db`, built from `content-src/` on first start and whenever the sources change (a
  digest is stored beside it). Nothing is written into the source tree. `pnpm --filter @bible/web run
  games:content -- check|import|stats|generate` is the author's tool (see `games/content.md`).
- **Strings**: only the app shell is catalogued (`games.json`: titles, tile, menus, the home/join/host/lobby
  chrome). Game content (questions, prompts, rule text inside a game) stays English for a later task. The
  phone page installs a tiny i18next instance with just the `games` namespace.

## Docs carried over

`games/content.md` (authoring content), `games/adr/` (decisions 0001 to 0006) and `games/handoff.md` (the
shared-screen host design). Commands in them that say `npm run ...` map to the pnpm scripts above; the module
directory is the host's, not `modules/`.

## Reconciliation of the two diverged branches

The stand-alone repo had two unmerged branches: `task/0037-games-changes-round-1` (UX round 1) and
`task/0039-shared-screen-host-impl` (screen, owner and display roles, phone as controller). They were merged in
a scratch clone before import. Decisions are recorded in the delivery of task 0115 (session cutoff on the
owner session, `HostApp` folded into `ScreenApp`, manage-players and full-standings in the control bar, and so
on).

## Not done

Desktop; sharing the transport and room-code code with the Presenter; translating game content; game content
strings; new games.
