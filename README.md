Keep Thy Heart Bible Reader
===========================
_Note: This is currently a work in progress, so stay tuned for updates!  I am working on providing beta installers next._

> For the word of God is quick, and powerful, and sharper than any twoedged sword, piercing even to the dividing asunder of soul and spirit, and of the joints and marrow, and is a discerner of the thoughts and intents of the heart.  (Hebrews 4:12)

Welcome to the Keep Thy Heart Bible app!  This project is an open-source set of Bible study applications (web, desktop) written in Node.JS.  The desktop app is based on Electron, to run in Windows, Mac, and Linux.  Modules (Bible translations, commentaries, etc.) are stored in SQLite .db files for compatibility.

A fresh clone is set up with one command (see [Quick Start](#quick-start)), which downloads a starter set of modules from the official signed module catalog. Modules use a new SQLite format; most were converted from SWORD modules, and the conversion scripts are to be released as a separate repository.

Screenshots and User Documentation
----------------------------------
**Desktop:**

[![Keep Thy Heart Bible Reader, desktop app](https://docs.bible.keepthyheart.com/assets/images/intro-overview-edf60c30c8a953c7212696737dc4cf6a.png)](https://docs.bible.keepthyheart.com/assets/images/intro-overview-edf60c30c8a953c7212696737dc4cf6a.png)

**Web:**

[![Keep Thy Heart Bible Reader, web app](https://docs.bible.keepthyheart.com/assets/images/intro-overview-1256097954b9d261401499f919087719.png)](https://docs.bible.keepthyheart.com/assets/images/intro-overview-1256097954b9d261401499f919087719.png)

**User Documentation:**

  - Home (will contain links to installers, etc., in future): [https://docs.bible.keepthyheart.com/](https://docs.bible.keepthyheart.com/)
  - Desktop: [https://docs.bible.keepthyheart.com/desktop/](https://docs.bible.keepthyheart.com/desktop/)
  - Web: [https://docs.bible.keepthyheart.com/web/](https://docs.bible.keepthyheart.com/web/)

Prerequisites
-------------
  - **Node.js 20.19 or newer.** 24 is recommended, and `.nvmrc` pins it, so `nvm install` / `nvm use` (nvm, fnm) pick it up. With nvm-windows, run `nvm install 24` and `nvm use 24`. The init script checks the version and says so if it is too old.
  - **npm** (the version bundled with Node) and **git**.
  - **Network access on the first run.** Setup downloads modules from the official module catalog, and the first `npm run dev` / `npm run dev:web` downloads the self-hosted fonts.
  - **Native build tools, only as a fallback.** The native dependencies (`better-sqlite3`, `better-sqlite3-multiple-ciphers` and others) normally install prebuilt binaries, including the Electron build of `better-sqlite3-multiple-ciphers` that `npm run setup` fetches. When no prebuilt binary matches your platform, Node or Electron version, npm compiles it with node-gyp, which needs Python 3 plus a C++ toolchain: Visual Studio Build Tools with the "Desktop development with C++" workload on Windows, the Xcode Command Line Tools on macOS, or `build-essential` on Linux. `keytar` is optional (it is only used to migrate an encryption key from older desktop installs), so a failure to build it, for example for want of `libsecret-1-dev` on Linux, does not stop `npm install`. If `npm install` sits compiling SQLite for several minutes, see [Troubleshooting](#troubleshooting): a slow DNS lookup of github.com, or broken IPv6 to it, makes every prebuilt download time out.

The commands below work from PowerShell, cmd or a POSIX shell.

Quick Start
-----------
```bash
git clone https://github.com/KeepThyHeart/bible.git
cd bible
npm install

npm run setup        # web and desktop
# or
npm run setup:web    # web only: skips the desktop init and the Electron rebuild

npm run dev:web      # web app: open http://localhost:5173/
npm run dev          # desktop app
```

`npm run setup` runs four steps, each of which is also a script of its own:

| Step | What it does |
|---|---|
| `npm run build:core` | Compiles `packages/core` (`@bible/core`) to `dist/`, which both apps import. |
| `npm run init:modules` | Downloads the `starter` module set (about 80 MB) from the official catalog into `data/modules/`, verifying the catalog's signature against the pinned official key, builds the module registry `data/main.db`, and writes `data/site-config.json` if there is none. |
| `npm run init:desktop` | Builds the desktop registry `apps/desktop/data/main.db` and links `apps/desktop/data/modules` to `data/modules`, so both apps share one set of module files. |
| `npm run rebuild-sqlite` | Fetches (or, failing that, compiles) the Electron build of the desktop's SQLite driver, since Electron has its own Node ABI. |

`npm run setup:web` is the first two. Re-running either is safe and quick: modules whose SHA-256 already matches are not downloaded again, an existing `site-config.json` is left alone, and an existing link is kept.

The init script prints "Catalog signature verified against the trusted key." for the catalog index and for each catalog it lists. If it refuses a catalog instead, do not work around it; report it, since everything under the official URL must be signed by a key pinned in `apps/desktop/electron/services/trustedCatalogKeys.ts`. The closing note listing test-only modules as not installed is expected: the starter set leaves them out on purpose, and they matter only for running the test suites (`--select=tests`, below).

Running the Apps
----------------
**Web:** `npm run dev:web` starts the Express API server (port 3100) and the Vite dev server (port 5173), which proxies `/api` to Express. Open http://localhost:5173/. The generated `data/site-config.json` has the password gate off, because no password is set; to turn it on, set `auth.enabled` to `true` and `auth.password` in that file (or supply the password through `SITE_PASSWORD`). See [apps/web/README.md](apps/web/README.md) for configuration.

**Desktop:** `npm run dev` starts the Electron app in development mode with hot reload. Its data lives in `apps/desktop/data/`. See [apps/desktop/README.md](apps/desktop/README.md) for building and packaging.

Both apps import `@bible/core` from its build output, so after changing anything under `packages/core/src/`, run `npm run build:core` and restart.

Modules
-------
A module is one SQLite `.db` file with a type prefix: `bible_kjv.db`, `commentary_barnes.db`, `dictionary_easton.db`, `topical_nave.db`, `xref_tsk.db`. Modules are content, not code, so they are not in the repository; `data/` is gitignored.

`npm run init:modules` installs a preset from the official catalog (`https://modules.bible.keepthyheart.com/`, whose signed `index.json` lists its catalogs). `npm run init:modules:dev` does the same from the unsigned development catalog (`https://modules-dev.bible.keepthyheart.com/modules/`), which prints an "UNSIGNED" warning:

| Preset | Download | Modules |
|---|---|---|
| `starter` (the default) | about 80 MB | KJV, ASV, Barnes, Easton, StrongsGreek, StrongsHebrew, NaveTopics, TSKxref, Scofield, Wesley |
| `tests` | about 170 MB | `starter` plus Clarke, Concord, AmTract and MHC: every module a test suite names |

The sizes are downloads; unpacked, the modules take several times as much disk space.

A preset module the catalog does not offer is skipped with a warning, and the rest of the preset still installs. Each app opens on KJV when it is installed and otherwise on the first installed Bible, and the generated `ui.defaultModule` follows the same rule. The commentary a fresh profile opens is the first of Gill, MHC and Wesley that is installed (Wesley, in a starter install), all of which cover both Testaments.

`tag_graph.db`, the entity graph behind the Topics pane's "Related" section, is not distributed and no feature needs it yet. Without it that section stays empty, and the test suites that exercise it skip themselves.

Where things go:

| Path | Contents |
|---|---|
| `data/modules/` | The module `.db` files, shared by both apps and the test suites |
| `data/main.db` | The module registry the web server and test suites read |
| `data/site-config.json` | Web configuration: which modules are visible, auth, search, UI defaults |
| `apps/desktop/data/main.db` | The desktop app's registry |
| `apps/desktop/data/modules` | A link to `data/modules` (a directory junction on Windows, a relative symlink elsewhere) |

To get more:

```bash
npm run init:modules -- --select=tests         # everything the test suites need
npm run init:modules -- --select=KJV,Clarke    # particular modules, by abbreviation
npm run init -- --catalog                      # choose from a list (official catalog)
```

If you already have module files, copy them into `data/modules/` and run `npm run init` to register them (and `npm run init:desktop` for the desktop). `npm run init -- --help` lists every option, including `--no-link` to keep a separate desktop copy.

The web app only shows modules listed in the `modules` section of `data/site-config.json` (a fail-safe for copyright), and that file is only generated when it is absent. So a module added later needs adding there, or delete the file and run `npm run init` to regenerate it from what is installed.

Repository Layout
-----------------
| Path | Contents |
|---|---|
| `apps/desktop/` | Electron desktop app (React, Zustand, Tailwind) |
| `apps/web/` | Web app: Preact client and Express API server |
| `packages/core/` | `@bible/core`: data access, services and models shared by both apps |
| `packages/extension-ui/`, `packages/extension-testing/`, `packages/create-extension/`, `packages/word-count-example/` | Extension SDK, test harness, scaffolder and an example extension |
| `scripts/` | Repository tooling: `init/` (module registry and catalog), plus the docs, branding and translation checks |
| `admin/` | Branding (`admin/brand/branding.json`), coding standards, third-party notices |
| `data/` | Generated and gitignored: the shared module store and web configuration |

Developing
----------
A few things worth knowing before your first change:

  - **Your desktop profile is shared.** In development the desktop keeps modules and `main.db` in the checkout (`apps/desktop/data/`), but your user database, its encryption key, approved catalog keys and diagnostics live in Electron's `userData` directory (`~/.config/@bible/desktop` on Linux, `%APPDATA%\@bible\desktop` on Windows, `~/Library/Application Support/@bible/desktop` on macOS). Every checkout on the machine uses that one profile. To keep a checkout's profile separate, point `ELECTRON_USER_DATA` at an absolute path, for example `ELECTRON_USER_DATA="$PWD/apps/desktop/data/profile" npm run dev` in a POSIX shell (`apps/*/data/` is gitignored).
  - **Run one test file or one test.** `npx vitest run path/to/file.test.ts` from inside the workspace (`packages/core`, `apps/web`, `apps/desktop`), adding `-t "name"` to filter by test name. `npm run test:watch -w @bible/core` (and the other workspaces) re-runs on save.
  - **Some desktop tests skip by default.** Tests that open a real database need `better-sqlite3-multiple-ciphers` built for Node, but a checkout set up for `npm run dev` holds the Electron build, so those suites skip themselves rather than fail. To run them: `npm rebuild better-sqlite3-multiple-ciphers`, run the tests, then `npm run rebuild-native:force -w @bible/desktop` before the next `npm run dev`.
  - **Lint** with `npm run lint -w @bible/web` or `npm run lint -w @bible/desktop`; type-check everything with `npm run typecheck`.
  - **Leave `PORT` unset for `npm run dev:web`.** The Vite proxy always targets 3100, so a `PORT` inherited from your shell or a launcher moves Express away from it and every `/api` call fails.
  - **Rebuild `@bible/core` after changing it.** Both apps import its `dist/`, so run `npm run build:core` (or `npm run watch -w @bible/core` in a second terminal) after editing `packages/core/src/`.

Common Commands
---------------
Run from the repository root.

| Command | Description |
|---|---|
| `npm run setup` / `npm run setup:web` | One-step setup, as above |
| `npm run dev:web` | Web app in development mode |
| `npm run dev` | Desktop app in development mode |
| `npm run build:core` | Build `@bible/core` (needed after changing it) |
| `npm run build:web` / `npm run build:desktop` | Production build of one app, core included |
| `npm run init` | Register the module files already in `data/modules/`; `-- --help` for options |
| `npm run init:modules` | Download the `starter` modules from the official catalog, then register them (`init:modules:dev` for the development catalog) |
| `npm run init:desktop` | Build the desktop registry and link its modules directory |
| `npm run rebuild-sqlite` | Fetch or rebuild the desktop's SQLite driver for Electron (skips it when already built) |
| `npm run test -w @bible/core` | Unit tests for one workspace (also `@bible/web`, `@bible/desktop`) |
| `npm test` | Build core, then run every workspace's unit tests (slow) |
| `npm run typecheck` | Type-check every workspace |
| `npm run check:docs` | Check that every file path in the feature docs still exists |
| `npm run branding:check` | Report branding values that are still undecided |
| `npm run clean` | Remove build output in every workspace |

Troubleshooting
---------------
**The desktop app fails with `NODE_MODULE_VERSION` ... was compiled against a different Node.js version.** A native module is built for system Node rather than Electron, typically after `npm install` or after `npm rebuild better-sqlite3-multiple-ciphers` (which the Node-run desktop unit tests need). `npm run rebuild-sqlite` skips modules that look built already, so force it:

```bash
npm run rebuild-native:force -w @bible/desktop
```

**`npm install` or `npm run setup` spends minutes compiling SQLite.** Each native module first downloads a prebuilt binary from GitHub, and compiles only when the download fails. Anything that stalls the download past its 15-second timeout makes it compile instead. That is harmless, just slower. Two causes are common, and on Linux `time getent ahosts github.com` tells them apart:

  - **The lookup itself takes seconds** (compare `getent ahostsv4 github.com`, which returns at once). Your DNS server is not answering IPv6 (`AAAA`) queries for github.com, so every lookup waits for them to time out. Forcing IPv4 in Node does not help, because it only reorders the answers after the wait. Point your system at a DNS server that answers `AAAA` queries, or accept the compile.
  - **The lookup is quick but the download still stalls.** IPv6 to GitHub is broken on your network. Forcing IPv4 (for example `NODE_OPTIONS=--dns-result-order=ipv4first npm run rebuild-sqlite`) usually makes it a download again.

**`init: better-sqlite3-web's native binding is missing or was built for a different Node.js`.** The web copy of SQLite was installed under another Node version. Rebuild it for the current one with `npm rebuild better-sqlite3-web` (the same as `npm run rebuild-sqlite -w @bible/web`). The web server hits the same error for the same reason.

**`init: This repository needs Node.js 20.19 or newer`.** Install Node 24, then re-run `npm install` so native modules are built for it.

**Font download fails on the first `npm run dev`.** The desktop fetches its fonts on `predev` and `prebuild`. Google Fonts is required: if it cannot be reached the script stops with instructions, so retry once you are online. Ezra SIL (the Hebrew font, from software.sil.org) is optional: a failure only warns, the app runs without it, and the download is retried after 24 hours. To retry now, run `npm run fonts -w @bible/desktop -- --force` (which re-downloads every font). The web app fetches its fonts on `npm run dev:web` the same way; `npm run fetch:fonts -w @bible/web -- --force` refetches them.

**`No catalog URL: none was given, BIBLE_MODULE_CATALOG_URL is not set ...`.** A bare `--catalog` defaults to `moduleRepositoryUrl` in `admin/brand/branding.json` (the official module site, whose signed `index.json` lists its catalogs), so this appears only when a `branding.local.json` clears that URL or lists it in `_undecided`. Use `npm run init:modules`, pass `--catalog=URL`, or set `BIBLE_MODULE_CATALOG_URL`. If the catalog itself is unreachable, copy module files into `data/modules/` and run `npm run init`.

**The web server exits with "password gate is enabled but no password is set".** Your `data/site-config.json` enables auth without a password. Set `auth.password`, set `SITE_PASSWORD`, or set `auth.enabled` to `false`.

**The web app shows no modules, or a module is missing.** Check that it is registered (`npm run init`) and listed with `active: true` in the `modules` section of `data/site-config.json`. If a fresh session shows "Failed to load chapter", `ui.defaultModule` names a Bible that is not installed; `npm run init` warns about this.

**A port is already in use.** Express uses 3100 (`PORT` overrides it) and Vite uses 5173. The Vite proxy always targets 3100, so in development free that port rather than changing `PORT`. If 5173 is taken, Vite moves to the next free port and prints the URL.

Resources:
  - For coding standards, see ./admin/coding-standards.
  - For third-party attributions and licence obligations, see ./admin/THIRD-PARTY-NOTICES.md.
  - Written using Claude Code
