/**
 * Developer Mode: load unpacked, hot-reload, and the things that
 * must NOT happen along the way.
 *
 * The interesting assertions here are mostly negative. Developer Mode moves an
 * extension's install path outside the directory the host owns, and three
 * pieces of existing behaviour assumed that never happens:
 *
 *   - uninstall recursively deletes `install_path` (would eat a source tree)
 *   - discovery prunes any row it cannot find under the extensions root
 *     (would drop every dev row on every boot)
 *   - install consent is tied to copying (a dev load copies nothing, and must
 *     still ask)
 *
 * Each of those has a test below, because each is silent when it regresses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ExtensionHost } from '../ExtensionHost';
import { ExtensionDevConfig } from '../ExtensionDevConfig';
import { watchTargets } from '../ExtensionDevWatcher';
import { FakeSql } from './fakeSql';

let tmpRoot: string;
let extensionsRoot: string;
let devProject: string;

const EXT_ID = 'ext.dev.unpacked-sample';

function manifest(version = '1.0.0', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: EXT_ID,
    name: 'Unpacked Sample',
    version,
    publisher: 'dev',
    engines: { bibleApp: '^1.0.0' },
    main: 'dist/main.js',
    permissions: ['bible:read'],
    activationEvents: ['onStartup'],
    ...extra,
  });
}

/** A developer's working directory: source they own, plus a built bundle. */
function makeDevProject(dir: string, version = '1.0.0'): void {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'extension.json'), manifest(version), 'utf8');
  writeFileSync(join(dir, 'dist', 'main.js'), 'exports.activate = () => {};', 'utf8');
  writeFileSync(join(dir, 'src', 'main.ts'), 'export function activate() {}', 'utf8');
}

function makeHost(opts: { devConfig?: ExtensionDevConfig; sql?: FakeSql } = {}): {
  host: ExtensionHost;
  sql: FakeSql;
} {
  const sql = opts.sql ?? new FakeSql();
  const host = new ExtensionHost({
    db: sql,
    extensionsRoot,
    ...(opts.devConfig ? { devConfig: opts.devConfig } : {}),
    // Approve everything the manifest asks for, without a dialog. The consent
    // *step* is still exercised - see the test that omits this.
    consentPrompter: async (req) => ({
      granted: true,
      grantedPermissions: req.requestedPermissions,
    }),
    devWatchDebounceMs: 30,
  });
  return { host, sql };
}

function devConfigOn(): ExtensionDevConfig {
  const cfg = new ExtensionDevConfig(join(tmpRoot, 'dev-config.json'));
  cfg.setDeveloperMode(true);
  return cfg;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'bible-devmode-'));
  extensionsRoot = join(tmpRoot, 'extensions');
  devProject = join(tmpRoot, 'my-extension');
  mkdirSync(extensionsRoot, { recursive: true });
  makeDevProject(devProject);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ExtensionDevConfig', () => {
  it('defaults to off and round-trips through the file', () => {
    const path = join(tmpRoot, 'cfg.json');
    const a = new ExtensionDevConfig(path);
    expect(a.isDeveloperMode()).toBe(false);

    a.setDeveloperMode(true);
    expect(new ExtensionDevConfig(path).isDeveloperMode()).toBe(true);

    a.setDeveloperMode(false);
    expect(new ExtensionDevConfig(path).isDeveloperMode()).toBe(false);
  });

  it('reads anything other than literal true as off', () => {
    // A privileged mode must not be switchable on by a truthy-ish value in a
    // corrupt or hand-edited file.
    const path = join(tmpRoot, 'weird.json');
    writeFileSync(path, JSON.stringify({ developerMode: 'yes' }), 'utf8');
    expect(new ExtensionDevConfig(path).isDeveloperMode()).toBe(false);
  });

  it('treats an unparseable file as off rather than throwing', () => {
    const path = join(tmpRoot, 'broken.json');
    writeFileSync(path, '{ not json', 'utf8');
    expect(new ExtensionDevConfig(path).isDeveloperMode()).toBe(false);
  });
});

describe('loadUnpacked', () => {
  it('is refused when Developer Mode is off', async () => {
    const cfg = new ExtensionDevConfig(join(tmpRoot, 'off.json'));
    const { host } = makeHost({ devConfig: cfg });

    const result = await host.loadUnpacked({ sourcePath: devProject });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DeveloperModeDisabled');
    expect(await host.listExtensions()).toHaveLength(0);
  });

  it('is refused when the host has no Developer Mode at all', async () => {
    const { host } = makeHost();
    const result = await host.loadUnpacked({ sourcePath: devProject });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DeveloperModeDisabled');
  });

  it('registers the developer directory in place, without copying', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });

    const result = await host.loadUnpacked({ sourcePath: devProject });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.installPath).toBe(devProject);
    expect(result.state.devMode).toBe(true);
    // The whole point: no *copy* landed under the extensions root. The
    // per-extension log directory does get created there - that is the
    // lifecycle logger, not an install - so check for the package files
    // rather than for the directory.
    expect(existsSync(join(extensionsRoot, EXT_ID, 'extension.json'))).toBe(false);
    expect(existsSync(join(extensionsRoot, EXT_ID, 'dist'))).toBe(false);
  });

  it('lands disabled, exactly like a fresh install', async () => {
    // Pointing the app at a directory must not put code in-process
    // before the developer has seen the load succeed.
    const { host } = makeHost({ devConfig: devConfigOn() });
    const result = await host.loadUnpacked({ sourcePath: devProject });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.enabled).toBe(false);
  });

  it('still runs the consent step', async () => {
    const sql = new FakeSql();
    const host = new ExtensionHost({
      db: sql,
      extensionsRoot,
      devConfig: devConfigOn(),
      // No consent prompter wired at all.
    });

    const result = await host.loadUnpacked({ sourcePath: devProject });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ConsentRequired');
  });

  it('reports the trust tier as untrusted for an unsigned build', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const result = await host.loadUnpacked({ sourcePath: devProject });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.trustTier).toBe('untrusted');
  });

  it('refuses to shadow an existing packed install', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });

    // A packed install of the same id, copied under the extensions root.
    const packedSource = join(tmpRoot, 'packed-source');
    makeDevProject(packedSource);
    const installed = await host.installExtension({ sourcePath: packedSource });
    expect(installed.ok).toBe(true);

    const result = await host.loadUnpacked({ sourcePath: devProject });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('install.already-exists');
      expect(result.message).toContain('Uninstall it');
    }
  });

  it('rejects a directory with no valid manifest', async () => {
    const empty = join(tmpRoot, 'empty');
    mkdirSync(empty, { recursive: true });
    const { host } = makeHost({ devConfig: devConfigOn() });

    const result = await host.loadUnpacked({ sourcePath: empty });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ManifestInvalid');
  });
});

describe('uninstalling an unpacked extension', () => {
  it('unregisters it without deleting the developer’s files', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const loaded = await host.loadUnpacked({ sourcePath: devProject });
    expect(loaded.ok).toBe(true);

    await host.uninstallExtension(EXT_ID);

    expect(await host.getExtension(EXT_ID)).toBeNull();
    // The source tree is the assertion that matters. Deleting it would be
    // data loss for the developer.
    expect(existsSync(join(devProject, 'src', 'main.ts'))).toBe(true);
    expect(existsSync(join(devProject, 'dist', 'main.js'))).toBe(true);
    expect(existsSync(join(devProject, 'extension.json'))).toBe(true);
  });

  it('still deletes the copy for a packed install', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const packedSource = join(tmpRoot, 'packed-source');
    makeDevProject(packedSource);
    const installed = await host.installExtension({ sourcePath: packedSource });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    expect(existsSync(join(installed.state.installPath, 'extension.json'))).toBe(true);

    await host.uninstallExtension(EXT_ID);

    // The package contents are gone. The directory itself may be recreated a
    // moment later by the lifecycle logger writing the "Uninstalled" line, so
    // assert on the files rather than on the directory.
    expect(existsSync(join(installed.state.installPath, 'extension.json'))).toBe(false);
    expect(existsSync(join(installed.state.installPath, 'dist'))).toBe(false);
    // ...and the source it was copied from is untouched, as always.
    expect(existsSync(packedSource)).toBe(true);
  });
});

describe('reloadUnpacked', () => {
  it('re-reads the manifest from disk', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const loaded = await host.loadUnpacked({ sourcePath: devProject });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.manifest.version).toBe('1.0.0');

    writeFileSync(join(devProject, 'extension.json'), manifest('1.1.0'), 'utf8');
    const reloaded = await host.reloadUnpacked(EXT_ID);

    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.state.manifest.version).toBe('1.1.0');
  });

  it('does not widen granted permissions when the manifest asks for more', async () => {
    // Otherwise Developer Mode would be a way to escalate without a dialog:
    // edit the manifest, rebuild, and the watcher grants it for you.
    const { host } = makeHost({ devConfig: devConfigOn() });
    const loaded = await host.loadUnpacked({ sourcePath: devProject });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.grantedPermissions).not.toContain('notes:write');

    writeFileSync(
      join(devProject, 'extension.json'),
      manifest('1.0.1', { permissions: ['bible:read', 'notes:write'] }),
      'utf8',
    );
    const reloaded = await host.reloadUnpacked(EXT_ID);

    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.state.manifest.permissions).toContain('notes:write');
    expect(reloaded.state.grantedPermissions).not.toContain('notes:write');
  });

  it('refuses to reload a packed install', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const packedSource = join(tmpRoot, 'packed-source');
    makeDevProject(packedSource);
    await host.installExtension({ sourcePath: packedSource });

    const result = await host.reloadUnpacked(EXT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NotDevMode');
  });

  it('reports a broken manifest instead of silently keeping the old one', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    await host.loadUnpacked({ sourcePath: devProject });

    writeFileSync(join(devProject, 'extension.json'), '{ broken', 'utf8');
    const result = await host.reloadUnpacked(EXT_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ManifestInvalid');
    const state = await host.getExtension(EXT_ID);
    expect(state?.status).toBe('failed');
  });

  it('is a no-op error for an unknown id', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const result = await host.reloadUnpacked('ext.nope.nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NotFound');
  });
});

describe('discovery across a restart', () => {
  it('keeps an unpacked extension whose directory lives outside the root', async () => {
    const sql = new FakeSql();
    const { host } = makeHost({ devConfig: devConfigOn(), sql });
    const loaded = await host.loadUnpacked({ sourcePath: devProject });
    expect(loaded.ok).toBe(true);

    // Second host over the same database - a restart.
    const { host: host2 } = makeHost({ devConfig: devConfigOn(), sql });
    await host2.loadAll();

    const state = await host2.getExtension(EXT_ID);
    expect(state).not.toBeNull();
    expect(state?.devMode).toBe(true);
    expect(state?.installPath).toBe(devProject);
  });

  it('drops the row once the developer’s directory is gone', async () => {
    const sql = new FakeSql();
    const { host } = makeHost({ devConfig: devConfigOn(), sql });
    await host.loadUnpacked({ sourcePath: devProject });

    rmSync(devProject, { recursive: true, force: true });

    const { host: host2 } = makeHost({ devConfig: devConfigOn(), sql });
    await host2.loadAll();

    expect(await host2.getExtension(EXT_ID)).toBeNull();
  });

  it('keeps the row when the directory is present but the manifest is mid-edit', async () => {
    // Dropping it would discard the permissions the user granted over what is
    // usually a transient syntax error.
    const sql = new FakeSql();
    const { host } = makeHost({ devConfig: devConfigOn(), sql });
    await host.loadUnpacked({ sourcePath: devProject });

    writeFileSync(join(devProject, 'extension.json'), '{ half-typed', 'utf8');

    const { host: host2 } = makeHost({ devConfig: devConfigOn(), sql });
    await host2.loadAll();

    expect(sql.extensions.has(EXT_ID)).toBe(true);
  });

  it('still prunes a packed row whose directory vanished', async () => {
    const sql = new FakeSql();
    const { host } = makeHost({ devConfig: devConfigOn(), sql });
    const packedSource = join(tmpRoot, 'packed-source');
    makeDevProject(packedSource);
    const installed = await host.installExtension({ sourcePath: packedSource });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    rmSync(installed.state.installPath, { recursive: true, force: true });

    const { host: host2 } = makeHost({ devConfig: devConfigOn(), sql });
    await host2.loadAll();

    expect(await host2.getExtension(EXT_ID)).toBeNull();
  });
});

describe('watchTargets', () => {
  // Use the same real directory the rest of the suite uses, so expectations do
  // not have to hand-roll platform path normalization.
  const root = (): string => devProject;

  it('watches the manifest and the entry file’s directory', () => {
    const targets = watchTargets(root(), 'dist/main.js');
    expect(targets).toContainEqual({ dir: root(), file: 'extension.json' });
    expect(targets).toContainEqual({ dir: join(root(), 'dist'), file: 'main.js' });
  });

  it('does not duplicate the root watch for a flat layout', () => {
    const targets = watchTargets(root(), 'main.js');
    expect(targets).toHaveLength(2);
    expect(targets[1]).toEqual({ dir: root(), file: 'main.js' });
  });

  it('skips an entry that escapes the extension directory', () => {
    // `main` is validated at manifest load, but this module also runs against
    // directories a developer picked by hand - so it re-checks rather than
    // assuming, and degrades to watching only the manifest.
    const targets = watchTargets(root(), '../../elsewhere/main.js');
    expect(targets).toEqual([{ dir: root(), file: 'extension.json' }]);
  });

  it('skips an absolute or URL entry', () => {
    expect(watchTargets(root(), '/etc/passwd')).toHaveLength(1);
    expect(watchTargets(root(), 'https://example.com/main.js')).toHaveLength(1);
  });

  it('tolerates a manifest with no entry point', () => {
    expect(watchTargets(root(), '')).toEqual([{ dir: root(), file: 'extension.json' }]);
  });
});

describe('hot reload', () => {
  it('picks up a rebuilt bundle without an explicit reload call', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    const loaded = await host.loadUnpacked({ sourcePath: devProject });
    expect(loaded.ok).toBe(true);

    // Simulate `npm run build`: rewrite the bundle *and* bump the manifest, so
    // the reload has something observable to prove it re-read from disk.
    writeFileSync(join(devProject, 'extension.json'), manifest('2.0.0'), 'utf8');
    writeFileSync(join(devProject, 'dist', 'main.js'), 'exports.activate = () => {1;};', 'utf8');

    await waitFor(async () => {
      const state = await host.getExtension(EXT_ID);
      return state?.manifest.version === '2.0.0';
    });

    const state = await host.getExtension(EXT_ID);
    expect(state?.manifest.version).toBe('2.0.0');
  });

  it('stops watching once Developer Mode is switched off', async () => {
    const cfg = devConfigOn();
    const { host } = makeHost({ devConfig: cfg });
    await host.loadUnpacked({ sourcePath: devProject });

    host.setDeveloperMode(false);
    expect(host.isDeveloperMode()).toBe(false);

    writeFileSync(join(devProject, 'extension.json'), manifest('3.0.0'), 'utf8');
    await delay(200);

    const state = await host.getExtension(EXT_ID);
    // Still loaded and usable - just no longer auto-reloading.
    expect(state).not.toBeNull();
    expect(state?.manifest.version).toBe('1.0.0');
  });

  it('does not resurrect an extension that was uninstalled mid-debounce', async () => {
    const { host } = makeHost({ devConfig: devConfigOn() });
    await host.loadUnpacked({ sourcePath: devProject });

    // Touch the bundle, then uninstall before the debounce elapses.
    writeFileSync(join(devProject, 'dist', 'main.js'), '// rebuilt', 'utf8');
    await host.uninstallExtension(EXT_ID);
    await delay(200);

    expect(await host.getExtension(EXT_ID)).toBeNull();
    // And the developer still has their files.
    expect(readFileSync(join(devProject, 'dist', 'main.js'), 'utf8')).toBe('// rebuilt');
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await delay(25);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
