# @bible/audio

The Audio Bible engine shared by the web app (Preact) and the desktop app (React + Electron):
the player, the recorded and on-device speech (Piper) providers, the source resolver, the
caches, preferences and a framework-neutral store. No UI and no app code.

- `AudioStore` takes the app's reader and module list through `ports.ts` (`AudioReaderPort`,
  `AudioModulesPort`); each app creates one instance (web: `apps/web/src/modules/audio/audioStore.ts`).
- `createAudioSystem(config, deps)` (`bootstrap.ts`) assembles providers, resolver, player and
  media session from an `AudioSiteConfig`; the app passes its engine factories, e.g.
  `createPiperFactory({ assets, fetchText, storage })`.
- Piper's engine and worker (`@bible/audio/piper`) load lazily. `storage: 'cache'` makes the
  worker read installed files from the Cache API (web); `'direct'` makes it fetch them by URL
  (desktop serves installed files on its own scheme).
- `@bible/audio/testing`: fakes (media element, output, providers, TTS engine, manifest source).

The design is in `apps/web/docs/features/audio.md`; the desktop side in
`apps/desktop/docs/features/audio.md`. Tests: `pnpm --filter @bible/audio test`.
