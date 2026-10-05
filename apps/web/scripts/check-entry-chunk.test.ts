import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs
import { checkReport } from './check-entry-chunk.mjs';

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
      { fileName: 'assets/b.js', isEntry: false, facadeModuleId: null, imports: [], modules: ['src/apps/present/route.ts', 'src/stores/bibleStore.ts'] },
    ] });
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o: { module: string }) => o.module)).toEqual([
      'src/DesktopApp.tsx', 'src/apps/present/route.ts', 'src/stores/bibleStore.ts',
    ]);
  });

  it('flags offline, browser search, the command barrel and Present components, but allows searchProviders', () => {
    const r = checkReport({ chunks: [
      entry([
        'src/main.tsx', 'src/present/command/searchProviders.ts', 'src/offline/BibleWorkerProxy.ts',
        'src/search/BrowserSearchProvider.ts', 'src/present/command/index.ts', 'src/present/command/CommandBox.tsx',
        'src/components/Present/PresentBar.tsx',
      ]),
    ] });
    expect(r.offenders.map((o: { module: string }) => o.module)).toEqual([
      'src/offline/BibleWorkerProxy.ts', 'src/search/BrowserSearchProvider.ts', 'src/present/command/index.ts',
      'src/present/command/CommandBox.tsx', 'src/components/Present/PresentBar.tsx',
    ]);
  });

  it('errors when there is no entry chunk', () => {
    expect(checkReport({ chunks: [] }).ok).toBe(false);
  });
});
