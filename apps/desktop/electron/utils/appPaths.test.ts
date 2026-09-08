/**
 * `main.db` must live somewhere the user can write, and must survive an app
 * upgrade.
 *
 * The bug these cover: building the path as `join(getDataPath(), 'main.db')`
 * puts it, in a packaged app, inside the install prefix - root-owned for a
 * `.deb`, inside the signed bundle on macOS, a read-only squashfs mount for an
 * AppImage, and a package-owned file that every upgrade replaces on all three.
 * `main.db` is not reference data: it carries `setting`, `saved_search`,
 * `search_history`, `module_repository` and the download queue.
 *
 * The failure is invisible on Windows, where `perMachine: false` installs into
 * a writable `%LocalAppData%\Programs\...`, so it needs pinning here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({ isPackaged: true, userData: '' }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getPath: () => state.userData,
  },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveMainDbPath } from './appPaths';

describe('resolveMainDbPath', () => {
  let root: string;
  let resourcesDir: string;
  let userDataDir: string;
  let bundledDb: string;
  let userDb: string;
  let originalResourcesPath: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apppaths-'));
    resourcesDir = join(root, 'resources');
    userDataDir = join(root, 'userData');
    mkdirSync(join(resourcesDir, 'data'), { recursive: true });
    mkdirSync(userDataDir, { recursive: true });

    bundledDb = join(resourcesDir, 'data', 'main.db');
    userDb = join(userDataDir, 'data', 'main.db');

    originalResourcesPath = process.resourcesPath;
    originalNodeEnv = process.env.NODE_ENV;
    // Electron defines this; Node does not. The cast keeps the assignment
    // honest rather than widening the global type for the whole suite.
    (process as { resourcesPath?: string }).resourcesPath = resourcesDir;
    process.env.NODE_ENV = 'production';

    state.isPackaged = true;
    state.userData = userDataDir;
  });

  afterEach(() => {
    (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it('seeds the bundled database into user data on first run', () => {
    writeFileSync(bundledDb, 'BUNDLED');

    const resolved = resolveMainDbPath();

    expect(resolved).toBe(userDb);
    expect(readFileSync(userDb, 'utf8')).toBe('BUNDLED');
  });

  it('leaves the bundled copy untouched', () => {
    writeFileSync(bundledDb, 'BUNDLED');

    resolveMainDbPath();

    // The prefix copy is a template. Writing through it is what made the app
    // unusable on read-only install locations.
    expect(readFileSync(bundledDb, 'utf8')).toBe('BUNDLED');
  });

  it('never overwrites an existing user database', () => {
    // The upgrade case: a fresh installer has just laid down a pristine
    // bundled main.db next to the user's accumulated settings, saved searches
    // and repository list. Re-seeding here would silently destroy all of it.
    writeFileSync(bundledDb, 'PRISTINE-FROM-INSTALLER');
    mkdirSync(join(userDataDir, 'data'), { recursive: true });
    writeFileSync(userDb, 'USER-STATE');

    const resolved = resolveMainDbPath();

    expect(resolved).toBe(userDb);
    expect(readFileSync(userDb, 'utf8')).toBe('USER-STATE');
  });

  it('returns a user-data path even when no bundled database exists', () => {
    // Degraded, but the schema gets created somewhere writable rather than
    // failing against a read-only prefix.
    const resolved = resolveMainDbPath();

    expect(resolved).toBe(userDb);
    expect(existsSync(join(userDataDir, 'data'))).toBe(true);
  });

  it('uses the in-tree data directory when not packaged', () => {
    state.isPackaged = false;

    const resolved = resolveMainDbPath();

    // Development keeps one directory for both trees, so nothing is copied and
    // the path must not point into userData.
    expect(resolved).not.toBe(userDb);
    expect(resolved.endsWith('main.db')).toBe(true);
    expect(existsSync(userDb)).toBe(false);
  });
});
