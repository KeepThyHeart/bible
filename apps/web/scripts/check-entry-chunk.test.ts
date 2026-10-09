import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs
import { checkReport, PHONE_ENTRY_FORBIDDEN } from './check-entry-chunk.mjs';

const entry = (modules: string[], imports: string[] = []) => ({
  fileName: 'assets/index.js', isEntry: true, facadeModuleId: 'index.html', imports, modules,
});

describe('checkReport', () => {
  it('passes a clean entry graph; lazy chunks may hold apps', () => {
    const r = checkReport({ chunks: [
      entry(['src/main.tsx'], ['assets/vendor.js']),
      { fileName: 'assets/vendor.js', isEntry: false, facadeModuleId: null, imports: [], modules: ['node_modules/x.js'] },
      { fileName: 'assets/study.js', isEntry: false, facadeModuleId: null, imports: [], modules: ['src/apps/study/StudyView.tsx'] },
    ] });
    expect(r.ok).toBe(true);
  });

  it('reports offenders in the entry and in transitive static imports', () => {
    const r = checkReport({ chunks: [
      entry(['src/main.tsx', 'src/DesktopApp.tsx'], ['assets/b.js']),
      { fileName: 'assets/b.js', isEntry: false, facadeModuleId: null, imports: [], modules: ['src/modules/present/app/PresenterApp.tsx', 'src/stores/bibleStore.ts'] },
    ] });
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o: { module: string }) => o.module)).toEqual([
      'src/DesktopApp.tsx', 'src/modules/present/app/PresenterApp.tsx', 'src/stores/bibleStore.ts',
    ]);
  });

  it('flags offline, browser search and Present module internals, but allows the manifest, binding, runtime and boot-probe libs', () => {
    const r = checkReport({ chunks: [
      entry([
        'src/main.tsx', 'src/modules/present/manifest.ts', 'src/modules/present/binding.ts', 'src/modules/present/runtime.ts',
        'src/modules/present/lib/controlLink.ts', 'src/modules/present/lib/sessionKey.ts',
        'src/offline/BibleWorkerProxy.ts', 'src/search/BrowserSearchProvider.ts',
        'src/modules/present/lib/command/index.ts', 'src/modules/present/lib/command/CommandBox.tsx',
        'src/modules/present/study/PresentBar.tsx', 'src/modules/present/module.ts', 'src/modules/present/stores/presentStore.ts',
      ]),
    ] });
    expect(r.offenders.map((o: { module: string }) => o.module)).toEqual([
      'src/offline/BibleWorkerProxy.ts', 'src/search/BrowserSearchProvider.ts', 'src/modules/present/lib/command/index.ts',
      'src/modules/present/lib/command/CommandBox.tsx', 'src/modules/present/study/PresentBar.tsx',
      'src/modules/present/module.ts', 'src/modules/present/stores/presentStore.ts',
    ]);
  });

  it('fails when the Present verse-action handler lands in the entry graph, passes in its own chunk', () => {
    const bad = checkReport({ chunks: [entry(['src/main.tsx', 'src/modules/present/app/presentVerseAction.ts'])] });
    expect(bad.ok).toBe(false);
    const ok = checkReport({ chunks: [
      entry(['src/main.tsx', 'src/host/builtinApps.ts']),
      { fileName: 'assets/pva.js', isEntry: false, facadeModuleId: null, imports: [], modules: ['src/modules/present/app/presentVerseAction.ts'] },
    ] });
    expect(ok.ok).toBe(true);
  });

  it('allows only the Quiz manifest and binding in the entry graph', () => {
    const r = checkReport({ chunks: [
      entry(['src/main.tsx', 'src/modules/quiz/manifest.ts', 'src/modules/quiz/binding.ts', 'src/modules/quiz/QuizPane.tsx', 'src/modules/quiz/module.ts']),
    ] });
    expect(r.offenders.map((o: { module: string }) => o.module)).toEqual(['src/modules/quiz/QuizPane.tsx', 'src/modules/quiz/module.ts']);
  });

  it('allows only the manifest and binding of Measures and Keyword marks in the entry graph', () => {
    const r = checkReport({ chunks: [
      entry([
        'src/main.tsx', 'src/modules/measures/manifest.ts', 'src/modules/measures/binding.ts', 'src/modules/measures/module.tsx',
        'src/modules/keyword-marks/manifest.ts', 'src/modules/keyword-marks/binding.ts', 'src/modules/keyword-marks/KeywordMarksButton.tsx',
      ]),
    ] });
    expect(r.offenders.map((o: { module: string }) => o.module)).toEqual([
      'src/modules/measures/module.tsx', 'src/modules/keyword-marks/KeywordMarksButton.tsx',
    ]);
  });

  it('errors when there is no entry chunk', () => {
    expect(checkReport({ chunks: [] }).ok).toBe(false);
  });

  it('keeps Games internals out of the reading entry; the manifest, binding and runtime are allowed', () => {
    const ok = checkReport({ chunks: [entry(['src/main.tsx', 'src/modules/games/manifest.ts', 'src/modules/games/binding.ts', 'src/modules/games/runtime.ts'])] });
    expect(ok.ok).toBe(true);
    const bad = checkReport({ chunks: [entry(['src/main.tsx', 'src/modules/games/app/GamesApp.tsx', 'src/modules/games/client/App.tsx', 'src/modules/games/module.ts'])] });
    expect(bad.offenders.map((o: { module: string }) => o.module)).toEqual([
      'src/modules/games/app/GamesApp.tsx', 'src/modules/games/client/App.tsx', 'src/modules/games/module.ts',
    ]);
  });
});

describe('checkReport for the Games phone page', () => {
  const phone = (modules: string[], imports: string[] = []) => ({
    fileName: 'assets/play.js', isEntry: true, facadeModuleId: 'games/play.html', imports, modules,
  });
  const run = (chunks: unknown[]) => checkReport({ chunks }, 'games/play.html', PHONE_ENTRY_FORBIDDEN);

  it('passes the games client and shared libraries', () => {
    expect(run([phone(['src/modules/games/client/main.tsx', 'src/modules/games/shared/protocol.ts', 'node_modules/preact/dist/preact.mjs'])]).ok).toBe(true);
  });

  it('flags any reader code, even through a shared chunk', () => {
    const r = run([
      phone(['src/modules/games/client/main.tsx'], ['assets/shared.js']),
      { fileName: 'assets/shared.js', isEntry: false, facadeModuleId: null, imports: [], modules: ['src/stores/bibleStore.ts', 'src/i18n.ts', 'src/modules/present/lib/qr.ts', 'src/host/appHost.ts'] },
    ]);
    expect(r.ok).toBe(false);
    expect(r.offenders).toHaveLength(4);
  });

  it('errors when the page is missing from the report', () => {
    expect(run([]).ok).toBe(false);
  });
});
