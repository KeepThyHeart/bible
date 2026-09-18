/**
 * Module discovery.
 *
 * Driven through a fake filesystem, so the five module roots can be
 * asserted on all three platforms from one machine. The last block runs against
 * the real checkout, which is the only way to know the descriptor reader
 * matches the actual module format.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type DiscoveryEnv,
  type ModuleDescriptor,
  type ModuleRoot,
  appDataRoot,
  defaultDiscoveryEnv,
  discoverModules,
  isSupportedSchema,
  moduleRoots,
  moduleTypeFromFilename,
  openModule,
  readModuleDescriptor,
} from './modules';

/** A fake tree: directory path → entries. */
function fakeEnv(
  tree: Record<string, string[]>,
  overrides: Partial<DiscoveryEnv> = {},
): DiscoveryEnv {
  const normalise = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const dirs = new Map(Object.entries(tree).map(([k, v]) => [normalise(k), v]));

  return {
    platform: 'linux',
    env: {},
    home: '/home/u',
    cwd: '/nowhere',
    exists: (p) => dirs.has(normalise(p)),
    isDirectory: (p) => dirs.has(normalise(p)),
    listDir: (p) => dirs.get(normalise(p)) ?? [],
    ...overrides,
  };
}

const kinds = (roots: readonly ModuleRoot[]) => roots.map((r) => r.kind);

describe('module type from filename', () => {
  test('maps every shipped prefix', () => {
    expect(moduleTypeFromFilename('bible_kjv.db')).toBe('bible');
    expect(moduleTypeFromFilename('commentary_mhc.db')).toBe('commentary');
    expect(moduleTypeFromFilename('dictionary_nave.db')).toBe('dictionary');
    expect(moduleTypeFromFilename('topical_nave.db')).toBe('topical_index');
    expect(moduleTypeFromFilename('xref_tsk.db')).toBe('cross_reference');
    expect(moduleTypeFromFilename('book_pilgrim.db')).toBe('book');
    expect(moduleTypeFromFilename('devotional_daily.db')).toBe('devotional');
    expect(moduleTypeFromFilename('lexicon_bdb.db')).toBe('lexicon');
  });

  test('tag_graph is matched before splitting, having no abbreviation segment', () => {
    expect(moduleTypeFromFilename('tag_graph.db')).toBe('tag_graph');
  });

  test('an unknown prefix is reported rather than guessed at', () => {
    expect(moduleTypeFromFilename('something_else.db')).toBe('unknown');
  });
});

describe('appData root per platform', () => {
  test('Windows uses APPDATA', () => {
    const env = fakeEnv({}, { platform: 'win32', env: { APPDATA: 'C:/Users/u/AppData/Roaming' } });
    expect(appDataRoot(env)).toBe('C:/Users/u/AppData/Roaming');
  });

  test('macOS uses Application Support', () => {
    const env = fakeEnv({}, { platform: 'darwin' });
    expect(appDataRoot(env)).toBe(join('/home/u', 'Library', 'Application Support'));
  });

  test('Linux honours XDG_CONFIG_HOME, falling back to ~/.config', () => {
    expect(appDataRoot(fakeEnv({}, { env: { XDG_CONFIG_HOME: '/xdg' } }))).toBe('/xdg');
    expect(appDataRoot(fakeEnv({}))).toBe(join('/home/u', '.config'));
  });
});

describe('root resolution', () => {
  test('only roots that exist are returned', () => {
    expect(moduleRoots(fakeEnv({}))).toEqual([]);
  });

  test('BIBLE_HOME comes first', () => {
    const env = fakeEnv(
      {
        '/custom/modules': ['bible_kjv.db'],
        '/home/u/.bible/modules': ['bible_asv.db'],
      },
      { env: { BIBLE_HOME: '/custom' } },
    );
    expect(kinds(moduleRoots(env))).toEqual(['override', 'cli']);
  });

  test('the desktop install is found by shape, not by name', () => {
    // A folder named nothing like the product still counts, because it has the
    // signature: data/modules with a .db in it.
    const env = fakeEnv({
      '/home/u/.config': ['Some Renamed App'],
      '/home/u/.config/Some Renamed App/data/modules': ['bible_kjv.db'],
    });

    const roots = moduleRoots(env);
    expect(kinds(roots)).toEqual(['desktop-user']);
    expect(roots[0]?.path).toContain('Some Renamed App');
  });

  test('only direct children of appData are probed', () => {
    // A deeper level would make the probe a tree walk; the desktop's userData
    // is a single directory named after the product.
    const env = fakeEnv({
      '/home/u/.config': ['Vendor'],
      '/home/u/.config/Vendor': ['App'],
      '/home/u/.config/Vendor/App/data/modules': ['bible_kjv.db'],
    });
    expect(moduleRoots(env)).toEqual([]);
  });

  test('a folder without data/modules is not mistaken for the desktop', () => {
    const env = fakeEnv({
      '/home/u/.config': ['SomeOtherApp'],
      '/home/u/.config/SomeOtherApp': ['settings.json'],
    });
    expect(moduleRoots(env)).toEqual([]);
  });

  test('a data/modules directory with no .db files does not count', () => {
    const env = fakeEnv({
      '/home/u/.config': ['App'],
      '/home/u/.config/App/data/modules': ['readme.txt'],
    });
    expect(moduleRoots(env)).toEqual([]);
  });

  test('the bundled tree is immutable and the user tree is not', () => {
    const env = fakeEnv({
      '/home/u/.config': ['Bible'],
      '/home/u/.config/Bible/data/modules': ['bible_kjv.db'],
      '/opt': ['Bible'],
      '/opt/Bible/resources/data/modules': ['bible_asv.db'],
    });

    const roots = moduleRoots(env);
    const user = roots.find((r) => r.kind === 'desktop-user');
    const bundled = roots.find((r) => r.kind === 'desktop-bundled');

    // Immutable is safe only where nothing writes.
    expect(user?.immutable).toBe(false);
    expect(bundled?.immutable).toBe(true);
  });

  test('macOS looks inside the .app bundle', () => {
    const env = fakeEnv(
      {
        '/Applications': ['Bible.app'],
        '/Applications/Bible.app/Contents/Resources/data/modules': ['bible_kjv.db'],
      },
      { platform: 'darwin' },
    );
    expect(kinds(moduleRoots(env))).toEqual(['desktop-bundled']);
  });

  test('the repo checkout is found by walking up from the working directory', () => {
    // Not from import.meta.dir: inside a compiled binary that points into the
    // embedded filesystem and would never find the repo.
    const env = fakeEnv(
      { '/src/bible/data/modules': ['bible_kjv.db'], '/src/bible/apps/desktop': [] },
      { cwd: '/src/bible/apps/cli' },
    );
    expect(kinds(moduleRoots(env))).toEqual(['repo']);
  });

  test('a data/modules folder outside a checkout is not mistaken for the repo', () => {
    const env = fakeEnv({ '/srv/data/modules': ['bible_kjv.db'] }, { cwd: '/srv/app' });
    expect(kinds(moduleRoots(env))).toEqual([]);
  });

  test('roots come back in priority order', () => {
    const env = fakeEnv(
      {
        '/custom/modules': ['a.db'],
        '/home/u/.bible/modules': ['b.db'],
        '/home/u/.config': ['Bible'],
        '/home/u/.config/Bible/data/modules': ['c.db'],
        '/opt': ['Bible'],
        '/opt/Bible/resources/data/modules': ['d.db'],
        '/src/bible/data/modules': ['e.db'],
        '/src/bible/apps/desktop': [],
      },
      { env: { BIBLE_HOME: '/custom' }, cwd: '/src/bible' },
    );

    expect(kinds(moduleRoots(env))).toEqual([
      'override',
      'cli',
      'desktop-user',
      'desktop-bundled',
      'repo',
    ]);
  });
});

describe('schema version support', () => {
  test('accepts what this build understands', () => {
    expect(isSupportedSchema('1.0.0')).toBe(true);
    expect(isSupportedSchema('2.0.0')).toBe(true);
    expect(isSupportedSchema('2.9.1')).toBe(true);
  });

  test('rejects a newer major version', () => {
    expect(isSupportedSchema('3.0.0')).toBe(false);
  });

  test('missing or unparseable versions are attempted rather than refused', () => {
    expect(isSupportedSchema(undefined)).toBe(true);
    expect(isSupportedSchema('unversioned')).toBe(true);
  });
});

describe('discovery', () => {
  const root: ModuleRoot = { path: '/m', kind: 'cli', immutable: false };

  const reader =
    (byName: Record<string, ModuleDescriptor | undefined>) =>
    (path: string): ModuleDescriptor | undefined =>
      byName[path.replace(/\\/g, '/')];

  test('reads each module\'s own self-description', () => {
    const env = fakeEnv({ '/m': ['bible_kjv.db'] });
    const modules = discoverModules({
      env,
      roots: [root],
      read: reader({
        '/m/bible_kjv.db': {
          abbreviation: 'KJV',
          fullName: 'King James Version',
          language: 'en',
          contentSha256: 'abc',
          schemaVersion: '2.0.0',
        },
      }),
    });

    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      abbreviation: 'KJV',
      fullName: 'King James Version',
      type: 'bible',
      language: 'en',
      unsupported: undefined,
    });
  });

  test('a file that is not a module is reported, and does not stop the scan', () => {
    const env = fakeEnv({ '/m': ['bible_kjv.db', 'broken.db', 'bible_asv.db'] });
    const modules = discoverModules({
      env,
      roots: [root],
      read: reader({
        '/m/bible_kjv.db': { abbreviation: 'KJV', contentSha256: 'a' },
        '/m/broken.db': undefined,
        '/m/bible_asv.db': { abbreviation: 'ASV', contentSha256: 'b' },
      }),
    });

    // The good modules are unaffected, and usable.
    const usable = modules.filter((m) => m.unsupported === undefined);
    expect(usable.map((m) => m.abbreviation)).toEqual(['ASV', 'KJV']);

    // The bad one is listed with a reason rather than dropped: a `.db` the user
    // can see on disk but cannot find in the app, with nothing saying why, is
    // what the modules screen exists to prevent.
    // Matched on the filename: `join` uses the platform separator, so the path
    // is `\mroken.db` on Windows and `/m/broken.db` elsewhere.
    const broken = modules.find((m) => m.path.endsWith('broken.db'));
    expect(broken?.unsupported).toBe('not a module file, or unreadable');
  });

  test('non-.db files are ignored', () => {
    const env = fakeEnv({ '/m': ['notes.txt', 'bible_kjv.db-wal', 'bible_kjv.db'] });
    const modules = discoverModules({
      env,
      roots: [root],
      read: reader({ '/m/bible_kjv.db': { abbreviation: 'KJV' } }),
    });
    expect(modules).toHaveLength(1);
  });

  test('duplicates collapse on abbreviation + sha, and the earlier root wins', () => {
    const env = fakeEnv({ '/mine': ['bible_kjv.db'], '/theirs': ['bible_kjv.db'] });
    const modules = discoverModules({
      env,
      roots: [
        { path: '/mine', kind: 'cli', immutable: false },
        { path: '/theirs', kind: 'desktop-user', immutable: false },
      ],
      read: reader({
        '/mine/bible_kjv.db': { abbreviation: 'KJV', contentSha256: 'same' },
        '/theirs/bible_kjv.db': { abbreviation: 'KJV', contentSha256: 'same' },
      }),
    });

    expect(modules).toHaveLength(1);
    expect(modules[0]?.root.kind).toBe('cli');
  });

  test('the same abbreviation with different content is kept as two modules', () => {
    const env = fakeEnv({ '/mine': ['bible_kjv.db'], '/theirs': ['bible_kjv.db'] });
    const modules = discoverModules({
      env,
      roots: [
        { path: '/mine', kind: 'cli', immutable: false },
        { path: '/theirs', kind: 'desktop-user', immutable: false },
      ],
      read: reader({
        '/mine/bible_kjv.db': { abbreviation: 'KJV', contentSha256: 'old' },
        '/theirs/bible_kjv.db': { abbreviation: 'KJV', contentSha256: 'new' },
      }),
    });
    expect(modules).toHaveLength(2);
  });

  test('an unsupported schema is listed with a reason, not dropped or thrown', () => {
    const env = fakeEnv({ '/m': ['bible_future.db'] });
    const [module] = discoverModules({
      env,
      roots: [root],
      read: reader({ '/m/bible_future.db': { abbreviation: 'FUT', schemaVersion: '9.0.0' } }),
    });

    // Dim the row rather than crash on an unexpected table shape.
    expect(module?.unsupported).toContain('newer than this build supports');
    expect(() => openModule(module!)).toThrow(/newer than this build supports/);
  });

  test('a module with no abbreviation falls back to its filename', () => {
    const env = fakeEnv({ '/m': ['bible_mystery.db'] });
    const [module] = discoverModules({
      env,
      roots: [root],
      read: reader({ '/m/bible_mystery.db': {} }),
    });
    expect(module?.abbreviation).toBe('bible_mystery');
  });
});

// --- against the real checkout -------------------------------------------

const REPO_MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const KJV = join(REPO_MODULES, 'bible_kjv.db');
const hasKjv = existsSync(KJV);

describe('against a real module', () => {
  test.skipIf(!hasKjv)('the descriptor reader matches the actual module format', () => {
    const descriptor = readModuleDescriptor(KJV, false);

    expect(descriptor).toBeDefined();
    expect(descriptor?.abbreviation).toBe('KJV');
    expect(descriptor?.language).toBe('en');
    expect(descriptor?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(descriptor?.schemaVersion).toBe('2.0.0');
    expect(isSupportedSchema(descriptor?.schemaVersion)).toBe(true);
  });

  test.skipIf(!hasKjv)('reads the same descriptor through an immutable open', () => {
    // The bundled tree uses immutable=1, so it must produce identical results.
    expect(readModuleDescriptor(KJV, true)?.abbreviation).toBe('KJV');
  });

  test('a module with no schema_version table is still read', () => {
    // v1 modules — the topical indexes shipped with the desktop among them —
    // have `module_info` but no `schema_version`. That query must not sink the
    // whole descriptor: `isSupportedSchema(undefined)` exists precisely to let
    // an early module through.
    const dir = mkdtempSync(join(tmpdir(), 'bible-cli-v1-'));
    const path = join(dir, 'topical_v1.db');
    try {
      const db = new Database(path, { create: true });
      db.run('CREATE TABLE module_info (module_type TEXT, abbreviation TEXT, full_name TEXT)');
      db.run("INSERT INTO module_info VALUES ('topical_index', 'NaveTopics', 'Nave''s Topical Bible')");
      db.close();

      const descriptor = readModuleDescriptor(path, false);
      expect(descriptor?.abbreviation).toBe('NaveTopics');
      expect(descriptor?.schemaVersion).toBeUndefined();
      expect(isSupportedSchema(descriptor?.schemaVersion)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!hasKjv)('a non-module file yields undefined rather than throwing', () => {
    expect(readModuleDescriptor(join(REPO_MODULES, 'does-not-exist.db'), false)).toBeUndefined();
  });

  test.skipIf(!hasKjv)('discovers the repo checkout and opens a module from it', () => {
    const modules = discoverModules({
      env: { ...defaultEnvForRepo(), cwd: join(import.meta.dir, '..', '..') },
    });

    const kjv = modules.find((m) => m.abbreviation === 'KJV' && m.type === 'bible');
    expect(kjv).toBeDefined();

    const sql = openModule(kjv!);
    expect(sql.queryOne<{ n: number }>('SELECT count(*) AS n FROM module_info')?.n).toBe(1);
    sql.close();
  });
});

/** The real environment, but with no BIBLE_HOME so the test is not affected by one. */
function defaultEnvForRepo(): DiscoveryEnv {
  const base = defaultDiscoveryEnv();
  return { ...base, env: { ...base.env, BIBLE_HOME: undefined } };
}
