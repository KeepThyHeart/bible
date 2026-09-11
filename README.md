Keep Thy Heart Bible Reader
===========================
This is an open-source Bible reader written in Node.JS.  Apps include desktop and website.  The desktop is based on Electron, to run in Windows, Mac, and Linux.  Modules (Bible translations, commentaries, etc.) are stored in SQLite .db files for compatibility.

A fresh clone is set up with one command (see [Quick Start](#quick-start)), which downloads a starter set of modules from the development catalog. Modules use a new SQLite format; most were converted from SWORD modules, and the conversion scripts are to be released as a separate repository.

[TODO: Screenshots of web/desktop]

Prerequisites
-------------
  - **Node.js 20.19 or newer.** 24 is recommended, and `.nvmrc` pins it, so `nvm install` / `nvm use` (nvm, fnm) pick it up. With nvm-windows, run `nvm install 24` and `nvm use 24`. The init script checks the version and says so if it is too old.
  - **npm** (the version bundled with Node) and **git**.
  - **Network access on the first run.** Setup downloads modules from the development catalog, and the first `npm run dev` / `npm run dev:web` downloads the self-hosted fonts.
  - **Native build tools, only as a fallback.** The native dependencies (`better-sqlite3`, `better-sqlite3-multiple-ciphers` and others) normally install prebuilt binaries, including the Electron build of `better-sqlite3-multiple-ciphers` that `npm run setup` fetches. When no prebuilt binary matches your platform, Node or Electron version, npm compiles it with node-gyp, which needs Python 3 plus a C++ toolchain: Visual Studio Build Tools with the "Desktop development with C++" workload on Windows, the Xcode Command Line Tools on macOS, or `build-essential` on Linux. `keytar` is optional (it is only used to migrate an encryption key from older desktop installs), so a failure to build it, for example for want of `libsecret-1-dev` on Linux, does not stop `npm install`.

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
| `npm run init:modules` | Downloads the `starter` module set (about 80 MB) from the development catalog into `data/modules/`, builds the module registry `data/main.db`, and writes `data/site-config.json` if there is none. |
| `npm run init:desktop` | Builds the desktop registry `apps/desktop/data/main.db` and links `apps/desktop/data/modules` to `data/modules`, so both apps share one set of module files. |
| `npm run rebuild-sqlite` | Fetches (or, failing that, compiles) the Electron build of the desktop's SQLite driver, since Electron has its own Node ABI. |

`npm run setup:web` is the first two. Re-running either is safe and quick: modules whose SHA-256 already matches are not downloaded again, an existing `site-config.json` is left alone, and an existing link is kept.

The development catalog is unsigned, so the init script prints an "UNSIGNED" warning while downloading. That is expected. So is the closing note listing test-only modules as not installed: the starter set leaves them out on purpose, and they matter only for running the test suites (`--select=tests`, below).

Running the Apps
----------------
**Web:** `npm run dev:web` starts the Express API server (port 3100) and the Vite dev server (port 5173), which proxies `/api` to Express. Open http://localhost:5173/. The generated `data/site-config.json` has the password gate off, because no password is set; to turn it on, set `auth.enabled` to `true` and `auth.password` in that file (or supply the password through `SITE_PASSWORD`). See [apps/web/README.md](apps/web/README.md) for configuration.

**Desktop:** `npm run dev` starts the Electron app in development mode with hot reload. Its data lives in `apps/desktop/data/`. See [apps/desktop/README.md](apps/desktop/README.md) for building and packaging.

Both apps import `@bible/core` from its build output, so after changing anything under `packages/core/src/`, run `npm run build:core` and restart.

Modules
-------
A module is one SQLite `.db` file with a type prefix: `bible_kjv.db`, `commentary_barnes.db`, `dictionary_easton.db`, `topical_nave.db`, `xref_tsk.db`. Modules are content, not code, so they are not in the repository; `data/` is gitignored.

`npm run init:modules` installs a preset from the development catalog (`https://modules-dev.bible.keepthyheart.com/modules/`):

| Preset | Size | Modules |
|---|---|---|
| `starter` (the default) | about 80 MB | KJV, ASV, Barnes, Easton, StrongsGreek, StrongsHebrew, NaveTopics, TSKxref, Scofield, Wesley |
| `tests` | about 170 MB | `starter` plus Clarke, Concord, AmTract and MHC: every module a test suite names |

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
npm run init -- --catalog=https://modules-dev.bible.keepthyheart.com/modules/   # choose from a list
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
| `npm run init:modules` | Download the `starter` modules from the development catalog, then register them |
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

**`npm run setup` spends a couple of minutes compiling during `rebuild-sqlite`.** That step first downloads a prebuilt Electron binary of the SQLite driver from GitHub, and compiles it only when the download fails. A network where IPv6 to GitHub is slow or broken can stall the download past its 15-second timeout, so it compiles instead. That is harmless, just slower; forcing IPv4 (for example `NODE_OPTIONS=--dns-result-order=ipv4first npm run rebuild-sqlite`) usually makes it a download again.

**`init: better-sqlite3-web's native binding is missing or was built for a different Node.js`.** The web copy of SQLite was installed under another Node version. Rebuild it for the current one with `npm rebuild better-sqlite3-web` (the same as `npm run rebuild-sqlite -w @bible/web`). The web server hits the same error for the same reason.

**`init: This repository needs Node.js 20.19 or newer`.** Install Node 24, then re-run `npm install` so native modules are built for it.

**Font download fails on the first `npm run dev`.** The desktop fetches its fonts on `predev` and `prebuild`. Google Fonts is required: if it cannot be reached the script stops with instructions, so retry once you are online. Ezra SIL (the Hebrew font, from software.sil.org) is optional: a failure only warns, the app runs without it, and the download is retried after 24 hours. To retry now, run `npm run fonts -w @bible/desktop -- --force` (which re-downloads every font). The web app fetches its fonts on `npm run dev:web` the same way; `npm run fetch:fonts -w @bible/web -- --force` refetches them.

**`No catalog URL: none was given, BIBLE_MODULE_CATALOG_URL is not set ...`.** A bare `--catalog` has no default yet, because the production module host is not serving (its URL is listed in `_undecided` in `admin/brand/branding.json`). Use `npm run init:modules`, pass `--catalog=URL`, or set `BIBLE_MODULE_CATALOG_URL`. If the development catalog itself is unreachable, copy module files into `data/modules/` and run `npm run init`.

**The web server exits with "password gate is enabled but no password is set".** Your `data/site-config.json` enables auth without a password. Set `auth.password`, set `SITE_PASSWORD`, or set `auth.enabled` to `false`.

**The web app shows no modules, or a module is missing.** Check that it is registered (`npm run init`) and listed with `active: true` in the `modules` section of `data/site-config.json`. If a fresh session shows "Failed to load chapter", `ui.defaultModule` names a Bible that is not installed; `npm run init` warns about this.

**A port is already in use.** Express uses 3100 (`PORT` overrides it) and Vite uses 5173. The Vite proxy always targets 3100, so in development free that port rather than changing `PORT`. If 5173 is taken, Vite moves to the next free port and prints the URL.

Resources:
  - For coding standards, see ./admin/coding-standards.
  - For third-party attributions and licence obligations, see ./admin/THIRD-PARTY-NOTICES.md.
  - Written using Claude Code
