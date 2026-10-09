# Migrating a feature onto the feature-module contract

This recipe is for Phase 2 of the feature-modules work: batches 2 to 6 (Genealogy, Timeline, Quiz, Reading plans,
Similar, Word study, Cross-ref graph, Measures, Keyword marks, Notifications, Downloads, Audio). The Presenter
(task 0123) was the first migration and is the worked example: read `apps/web/src/modules/present/` and
`apps/web/server/modules/present/` side by side with this page.

The contract is in `packages/core/src/Modules/FeatureModule.ts`, and its rules are in that file's header. In short:

- Only manifests load at boot.
- A module's code loads only on its activation events.
- A disabled module contributes nothing.
- Core events reach only active modules that declared them.

## The goal of a migration

When it is done:

- **The feature lives in one folder per app.** That means `apps/web/src/modules/<id>/`,
  `apps/desktop/src/ui/modules/<id>/`, `apps/desktop/electron/modules/<id>/` and `apps/web/server/modules/<id>/`
  (only the ones the feature has).
- **The host does not import it.** Outside the folder there are no imports of the feature, only the one line in
  each `builtinModules` / `serverModules` / `MAIN_MODULES` list. The host may keep generic code the feature
  used (stores, utilities). It must not keep feature UI, feature stores or feature strings.
- **The feature is fully off when disabled.** Switching it off removes every contribution: apps, panes and panels,
  tiles, verse actions, settings sections, status items, routes and strings. The apps still boot.
- **Nothing visible changes while the module is on.** Persisted ids (panel types, pane modes, app ids, verse-action
  ids, setting keys, URLs) never change.
- **Startup stays flat.** No chunk of the feature is fetched at boot unless the feature is on screen.

## Steps

### 1. Inventory

Before moving anything, list every seam the feature touches. Start from the wiring table in the 0113 analysis
(`feature-modules-2026-10-05.md` §1), then confirm it with `git grep`:

```
git grep -n -i -E "<id>|<FeatureName>" -- apps packages | grep -v -E "^apps/(web|desktop)/.*/<feature folders>/"
```

Sort each hit into one of these:

- **Contribution**: an app, pane, panel, tile, verse action, settings section, status item, server route or
  namespace. It moves to the manifest.
- **Feature code**: components, stores, hooks or utilities only this feature uses. It moves into the folder.
- **Integration into a host view**: something rendered inside the reader, a toolbar or the shell. It becomes a
  **slot** registration (see step 5).
- **Shared code**: used by the feature and something else. It stays in the host, or moves to `@bible/ui` or core.
  Do not make the host import the module.

### 2. Move the files (pure move, its own commit)

Move the files with `git mv`, so git records renames. Rewrite the relative imports with a script rather than by
hand; task 0123 used one that resolves each relative specifier from the file's old location and rewrites it for the
new one, including `vi.mock('…')` paths. Check the following, then commit the move alone (no logic changes), so
the review diff stays readable:

- HTML entry points (`apps/web/present/*.html` `src=`)
- `tsconfig.server.json` `include`
- `vite.config.ts` inputs
- `apps/web/scripts/check-entry-chunk.mjs`
- any path strings in tests

Typecheck after the move.

### 3. The manifest (`manifest.ts`, data only)

```ts
export const quizManifest: FeatureModuleManifest = {
  id: 'quiz',
  flag: 'quiz',                         // when a FEATURE_FLAGS entry exists
  platforms: ['web'],                   // omit for both
  hooks: [{ event: 'reader.chapterRendered' }],   // only if the code handles it
  contributes: {
    apps: [...], verseActions: [...], paneModes: [...], panelTypes: [...],
    newTabTiles: [...], settings: [...], preferencesSections: [...], statusBarItems: [...],
    i18nNamespace: 'quiz',
    serverRoutes: [{ id: 'quiz-api', path: '/api/quiz' }],  // informational on clients
  },
};
```

- **Copy ids, orders and LabelRef keys exactly** from where the host declared them. Remove the item from the host
  manifest it came from (`apps/web/src/modules/host/ui.ts`, `apps/web/src/modules/host/panes.ts`, `apps/desktop/src/ui/modules/host/`), and update
  that manifest's snapshot test.
- **A tile that opens a bare page** uses `target: { href: '/watch' }`. A tile that runs a command uses
  `{ commandId }`. Web home tiles fire `onCommand:<id>` before running it.
- **`when` keys**: `<appId>.live` (the app is busy) works for any app. Anything else needs an evaluator in the
  host (`apps/web/src/host/verseActionWhen.ts`).
- **An app that draws its own top bar** sets `ownChrome: true` on its descriptor.

### 4. The binding (`binding.ts`, entry-chunk code)

The binding is imported at boot, so it holds only lazy loaders and at most a cheap boot probe. On web it is a
`WebFeatureModule` (`apps/web/src/modules/moduleHost.ts`):

```ts
export const quizModule: WebFeatureModule = {
  manifest: quizManifest,
  binding: { id: 'quiz', load: () => import('./module'), views: { 'pane:quiz': () => import('./QuizPaneView') } },
  apps: [{ id: 'quiz', load: () => import('./app/QuizApp').then((m) => ({ View: m.QuizApp })) }],
  verseActionHandlers: [{ id: 'quiz.fromVerse', load: () => import('./verseAction').then((m) => m.handler) }],
  probe() { return null; },   // optional; see below
};
```

- **`apps` and `verseActionHandlers`** are registered only while the module is enabled. Activating the app (not
  prefetching its chunk on hover) or running the verse action first fires `onApp:<id>` / `onVerseAction:<id>`, so
  `module.ts` is active before the app renders. If the module fails to activate, the app fails to start (with Retry).
- **`views`** are lazy components for `pane:<id>`, `panel:<type>` and `preferences:<id>`. **A view must not be
  imported statically anywhere else.** If the host also imports the same file, Rollup splits it (and its shared
  deps) into separate chunks, and they are fetched at boot anyway. That was the Phase 1 regression: 45 JS
  requests instead of 21. A pane is either eager (rendered by the host, with no view) or lazy (a view only), never
  both.
- **`probe()`** runs once at boot, after the client config is known and before the first app is chosen. It is
  synchronous and cheap (a URL or `localStorage` check). It may take a handoff out of the URL. It returns
  `{ initialApp?, busyApps?, activate? }`, and `activate: true` activates the module after first paint (event
  `onBootProbe`). Most modules have no probe. The Presenter uses it for its control and follow links and for a
  saved session.
- **`takeUrl()`** (rare): runs before the shell fetches its config, for every built-in module, enabled or not. It is
  only for moving a secret out of the address bar (the Presenter's control token); `probe()` then uses what it took.
- **Strings**: a module with `i18nNamespace` has its `binding.load` wait for the namespace, so the strings are
  there when its code runs. See step 8 for which keys stay in `ui.json`.

Add the entry to `apps/web/src/modules/builtinModules.ts` (and the desktop/main/server lists): one line each.

### 5. The module code (`module.ts`, lazy)

```ts
export async function activate(ctx: FeatureModuleContext) {
  ctx.subscriptions.push(
    verseDecorators.register(myDecorator),     // per-verse classes / rail / replacement text
    readerOverlays.register(MyReaderBar),      // inside the reader, after the verses
    studyBanners.register(MyBanner),           // above Study's layout
    shellOverlays.register(MyGlobalKeys),      // once, whichever app is shown
  );
}
export const hooks = { 'reader.chapterRendered': (p) => { /* ... */ } };
```

- **Everything registered goes into `ctx.subscriptions`**, so deactivation (or switching the module off) removes
  it.
- **Host slots** are in `apps/web/src/host/slots.tsx`. A decorator is a plain function read during render. Call
  `verseDecorators.invalidate()` when what it returns changes, and compare a cheap key first so the reader does
  not re-render on unrelated store changes (see `decorationKey()` in the Presenter's `module.ts`).
- **Need a new slot?** Add it to `slots.tsx` with a generic name and render it in the host with `SlotOutlet` /
  `useSlot`. Never name the feature in host code.
- **Core events**: declare them in `manifest.hooks` and export handlers in `hooks`. The dispatch sites build no
  payload while no active module listens, so hooks are free for everybody else. The events are:
  - `reader.verseChanged` / `reader.selectionChanged`: web and desktop, from the Bible stores.
  - `reader.chapterRendered`: once per chapter actually painted (web: `BibleContent`, keyed on the rendered
    verses; desktop: when a panel's verses for a chapter arrive). Consecutive repeats are dropped.
  - `settings.changed` / `app.didActivate`.
  Prefer a hook to subscribing to a host store from the module.
- **Styles**: import the feature's stylesheet from `module.ts` **and** from every chunk that can render before the
  module activates (an app's companion strip, its views), not from `main.scss`. Vite loads it once, with whichever
  chunk comes first. Move the feature's rules out of host stylesheets too: they load later, so they still win where
  they won before.

### 6. Server (`apps/web/server/modules/<id>/`)

- Add an entry to `apps/web/server/modules/serverModules.ts`: `{ manifest, load: async () => { await import('./<id>/routes.js'); await import('./<id>/pages.js'); } }` (sequential
  awaits, so routes register in a fixed order).
  Route files self-register through `registerRoute`. A large request body uses `registerBodyParser({ path, limit })`.
  Pages above the SPA catch-all are routes too, and they get `deps.extra.clientDir`.
- List every path in `contributes.serverRoutes`. While the module is off, each one answers 404 "not available"
  (JSON for API calls, a small HTML page for navigations), and `/api/config` lists the module under
  `modules.disabled`. The web client then treats it as off too.
- Remove the side-effect import from `apps/web/server/index.ts`.

### 7. Desktop main process (`apps/desktop/electron/modules/<id>/`)

A `FeatureMainModule` (`registerIpc(ipc, deps)`, optional `close()`) goes in `MAIN_MODULES`. The renderer calls it
through `createModuleClient('<id>')` instead of a hand-written preload surface. The dev overrides there are
`KTH_MODULES=-<id>` and `KTH_FLAGS=<flag>`. A load that hangs is reported after 10 s.

### 8. Strings

Move the keys the feature's **code** renders from `locales/<lng>/ui.json` to `locales/<lng>/<namespace>.json` in
**every** locale, including `xx-rtl`. Keep the fully qualified key paths (`present.sendVerse` stays
`present.sendVerse`), because the namespace is merged into `ui`.

**Manifest labels stay in `ui.json`**: the keys named by the manifest's contributions (app title, tile title,
verse-action title, pane and section titles). They are shown before the module's code ever loads, and react-i18next
does not re-render when a namespace arrives later, so moving them would show English labels to everyone else
(VS Code keeps these in `package.nls.json` for the same reason). While the module is off they are unused data.

The Presenter used a small Python script over all locale folders. Pages outside the app that use the strings (such
as the Presenter's solo viewer) call `loadNamespace('<ns>')` themselves.

## Checklist

- [ ] Inventory done; every hit sorted.
- [ ] Pure move committed on its own; typecheck clean.
- [ ] Manifest: ids, orders and keys unchanged; removed from the host manifests (snapshots updated).
- [ ] Binding: lazy loaders only. No view file is also imported statically. Added to `builtinModules`.
- [ ] Host: `git grep` finds no import of the module outside its folder (except the `builtinModules`,
      `serverModules` and `MAIN_MODULES` lines). No feature name in host code except data ids.
- [ ] Integration through slots, hooks or contribution points; everything is in `ctx.subscriptions`.
- [ ] Code strings in the module's namespace in all locales; manifest labels still in `ui.json`.
- [ ] Server routes through the module table; `serverRoutes` lists every path.
- [ ] `apps/web/scripts/check-entry-chunk.mjs` forbids `src/modules/<id>/` except the manifest, the binding and what the
      probe imports.
- [ ] Off switch tested (below). Startup measured (below).
- [ ] Demo: stills of the feature working as before and of the off switch.

## Tests a migrated module needs

1. **Manifest**: validates (`checkFeatureModuleManifest` / `validateBuiltinManifest`); its ids match the old ones.
2. **On by default, nothing loaded**: after `registerBuiltinModules()` the contributions exist and `binding.load`
   was not called.
3. **Off switch**: with `localStorage['kth.modules'] = '-<id>'` (and, for a server-backed module,
   `setClientConfig({ modules: { disabled: ['<id>'] } })`), none of the contributions exist (app, tiles, verse
   action, panes, settings, namespace), its app binding and verse-action handlers are not registered, its probe
   does not run, and every other module is unaffected. Do this through the real host
   (`vi.resetModules()` + dynamic import, see `apps/web/src/modules/builtinModules.test.ts`).
4. **Switched off at runtime**: override, then `reconcileModules()`; its registered contributions disappear.
5. **Activation**: loading its app (or running its verse action) fires `onApp:` / `onVerseAction:` and the module
   is active. A probe is tested per case (URL, saved state, nothing).
6. **Hooks**: an inactive or disabled module receives nothing, and the dispatch site does not build the payload
   (spy on the payload getter). An active one receives the payload from the real dispatch site.
7. **Server**: disabled means the route files are never imported, nothing is registered, and the declared paths
   answer 404 "not available" (JSON and HTML). Enabled means its routes are tagged with the module id.
8. **Behaviour tests moved with the code.** Tests of the feature's own UI move into the module folder and keep
   their assertions; the host's tests keep a generic test of the seam (for example, a `VerseRenderer` decoration).
9. **Guards**: `pnpm --filter @bible/web run build:client` (runs the entry-chunk check), the catalog checks
   (`pnpm run check:translations`, `pnpm --filter @bible/web run check:locale-schemas`), and lint and typecheck on
   every package.

## Measuring startup

Use `apps/web/scripts/measure-startup.mjs` (task 0123). It serves each built tree with its real
server and makes N cold loads in fresh Chromium contexts, in interleaved rounds. It reports the median time to the
first visible verse, the time the splash is removed, and the JS request count and KB, plus the URL lists:

```
DATA_CHECKOUT=<checkout with data/> node apps/web/scripts/measure-startup.mjs --n=7 --rounds=2 --out=r.json <baseline tree> <branch tree>
```

The JS request count is deterministic, so compare it first. The branch must not fetch a chunk of the migrated
feature at boot (check the `before` URL list). For timings, use a quiet machine and n ≥ 7. Task 0123's reference:
pre-modules 544 ms with 21 requests, next/0.2 before the fix 640 ms with 45, after the fix 544 ms with 22.
