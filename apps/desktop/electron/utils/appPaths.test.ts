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

import { getDataPath, getUserDataPath, resolveMainDbPath } from './appPaths';

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

/**
 * The premise every "seed it into user data" fix rests on: outside a packaged
 * build the two trees are ONE directory.
 *
 * Callers rely on this to reason about risk - moving something from
 * `getDataPath()` to `getUserDataPath()` (extension databases and lifecycle
 * logs, most recently) can only change behaviour in a packaged app, because
 * developers and CI get the same path either way. If that ever stops being
 * true, those changes stop being no-ops for everyone and this test is where it
 * should be noticed.
 */
describe('getDataPath / getUserDataPath', () => {
  let root: string;
  let originalResourcesPath: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apppaths-roots-'));
    originalResourcesPath = process.resourcesPath;
    originalNodeEnv = process.env.NODE_ENV;
    (process as { resourcesPath?: string }).resourcesPath = join(root, 'resources');
    process.env.NODE_ENV = 'production';
    state.userData = join(root, 'userData');
  });

  afterEach(() => {
    (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves to the identical directory when not packaged', () => {
    state.isPackaged = false;

    expect(getUserDataPath()).toBe(getDataPath());
  });

  it('resolves to the identical directory when NODE_ENV is development', () => {
    // e2e runs unpackaged; `npm run dev` also sets NODE_ENV. Either branch
    // alone is enough, and both must agree.
    state.isPackaged = true;
    process.env.NODE_ENV = 'development';

    expect(getUserDataPath()).toBe(getDataPath());
  });

  it('splits into resources/ and userData/ once packaged', () => {
    state.isPackaged = true;

    expect(getDataPath()).toBe(join(root, 'resources', 'data'));
    expect(getUserDataPath()).toBe(join(root, 'userData', 'data'));
    expect(getUserDataPath()).not.toBe(getDataPath());
  });
});
