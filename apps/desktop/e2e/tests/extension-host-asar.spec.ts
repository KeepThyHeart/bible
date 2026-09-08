/**
 * Packaged-build (asar) extension host verification.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ExtensionHost` forks the extension worker with
 * `join(__dirname, 'extension-runtime', 'index.js')` - a path *inside*
 * `app.asar` once the app is packaged (`asar: true` in electron-builder.yml).
 * Native `.node` binaries genuinely cannot be loaded out of an asar archive,
 * so "can `utilityProcess.fork()` boot a plain JS script from inside the
 * archive?" is a real packaging risk. Every other E2E test in this folder runs
 * the *unpacked* `out/main/index.js`, which never exercises asar at all, so
 * nothing else in the suite can answer the question.
 *
 * This file launches the PACKAGED binary and proves the worker actually ran:
 *
 *   1. `out/main/extension-runtime/index.js` is inside `app.asar` and is NOT
 *      in `app.asar.unpacked` - i.e. the risky path is the one under test.
 *   2. A sideloaded extension activates; the host records status `active`,
 *      which requires the worker to have replied to the host's `runtime.init`
 *      request (host -> worker -> host).
 *   3. Code running inside `activate()` - i.e. inside the utility process -
 *      writes evidence files whose `process.argv[1]` is the asar-resident
 *      runtime entry and whose pid differs from the main process's.
 *   4. A `storage.set` + `storage.get` pair issued from the worker resolves,
 *      proving a full worker -> host -> worker round trip, not just a spawn.
 *
 * PREREQUISITE: a packaged build must exist. Produce one with:
 *
 *     npm run build                      # from the repo root (core + desktop)
 *     cd apps/desktop
 *     npx electron-builder --win --dir   # or --linux --dir / --mac --dir
 *
 * If no packaged build is present the tests skip with a loud message - a dev
 * build does not use asar and cannot answer this question.
 *
 * HOST BUGS THESE TESTS ONCE DOCUMENTED - both now FIXED (neither was caused
 * by asar; both reproduced identically against the unpacked dev build):
 *
 *   A. `ExtensionRuntime.init()` called `import(payload.manifest.main)` with
 *      the manifest's RELATIVE path (`"./main.js"`). Nothing resolved it
 *      against the extension's `installPath`, so it resolved against the
 *      runtime bundle instead and every on-disk extension failed to load with
 *      "Cannot find module .../out/main/extension-runtime/main.js imported
 *      from .../out/main/extension-runtime/index.js". `main` is required to be
 *      relative by the manifest validator, so no extension could work around
 *      it. FIXED: the host now sends `installPath` in the init payload and
 *      `extension-runtime/resolveEntry.ts` resolves + containment-checks the
 *      entry point against it. -> the last test in this file is the regression
 *      guard (it carried `test.fail()` while the bug was open).
 *
 *   B. `extension-runtime/index.ts` buffered every envelope that arrived
 *      before init resolved. Since `activate()` runs *during* init, any
 *      host-API call an extension AWAITED inside `activate()` never saw its
 *      response and deadlocked until the 5 s activate timeout, which then
 *      killed the worker. FIXED: `response` and `heartbeat` envelopes now
 *      dispatch immediately; only events and inbound requests are queued.
 *      The fixtures here still defer their RPC to a post-activate
 *      `setTimeout` - that path must keep working either way.
 */

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DESKTOP_ROOT = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.join(DESKTOP_ROOT, 'dist');
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'asar-probe-extension');

/** Extension id of the checked-in on-disk fixture (`main: "./main.js"`). */
const ONDISK_EXTENSION_ID = 'ext.test.asarprobe';
/** Extension id of the generated `data:` URL fixture (bug A work-around). */
const INLINE_EXTENSION_ID = 'ext.test.asarinline';

/**
 * Tags the fixtures prefix their findings with. A sandboxed extension has no
 * filesystem, so `console.log` - forwarded by the supervisor as a
 * `__runtime.log` event and recorded in `extension.log` - is its only channel
 * back to the test. That it is the only channel is the point.
 */
const PROBE_TAG = 'ASAR_PROBE';
const RPC_TAG = 'ASAR_PROBE_RPC';

/**
 * Entry point for the inline fixture, embedded in a `data:text/javascript`
 * URL so that module resolution cannot be defeated by bug A (a `data:` URL is
 * self-contained - there is no base path to resolve it against). It is
 * otherwise identical in intent to `fixtures/asar-probe-extension/main.js`.
 *
 * If bug A is ever fixed, this test keeps working unchanged; the inline
 * fixture simply stops being the only way to reach a live worker.
 */
const INLINE_ENTRY_SOURCE = `
exports.activate = function activate(api) {
  var probe = {};
  try { require('fs'); probe.require = 'ALLOWED'; }
  catch (err) { probe.require = 'denied'; }
  probe.typeofProcess = typeof process;
  probe.apiKeys = Object.keys(api).length;
  console.log('ASAR_PROBE ' + JSON.stringify(probe));

  // Deferred until after activate() returns — see bug B in the file header.
  setTimeout(function () {
    Promise.resolve(api.storage.set('asarProbe', 'round-trip-ok'))
      .then(function () { return api.storage.get('asarProbe'); })
      .then(function (value) {
        console.log('ASAR_PROBE_RPC ' + JSON.stringify({ ok: true, value: value }));
      }, function (err) {
        console.log('ASAR_PROBE_RPC ' + JSON.stringify({
          ok: false, error: String(err && err.message ? err.message : err)
        }));
      });
  }, 300);
};
exports.deactivate = function deactivate() {};
`;

function inlineManifest(): Record<string, unknown> {
  return {
    id: INLINE_EXTENSION_ID,
    name: 'Asar Inline Probe',
    version: '1.0.0',
    publisher: 'bible-app',
    description:
      'E2E fixture with a self-contained data: URL entry point, used to reach a live extension worker in a packaged asar build.',
    engines: { bibleApp: '^1.0.0' },
    main: 'data:text/javascript,' + encodeURIComponent(INLINE_ENTRY_SOURCE),
    permissions: [],
    activationEvents: ['onStartup'],
  };
}

interface PackagedApp {
  /** Binary Playwright launches. */
  executablePath: string;
  /** The packaged `resources/` directory (contains app.asar and data/). */
  resourcesPath: string;
}

/**
 * Locate a packaged build under `dist/`. Returns null when none exists so the
 * tests can skip with an actionable message instead of failing obscurely.
 */
function findPackagedApp(): PackagedApp | null {
  if (!fs.existsSync(DIST_DIR)) return null;

  if (process.platform === 'win32') {
    const unpacked = path.join(DIST_DIR, 'win-unpacked');
    if (!fs.existsSync(unpacked)) return null;
    const exe = fs
      .readdirSync(unpacked)
      .find((f) => f.endsWith('.exe') && f.toLowerCase() !== 'elevate.exe');
    if (!exe) return null;
    return {
      executablePath: path.join(unpacked, exe),
      resourcesPath: path.join(unpacked, 'resources'),
    };
  }

  if (process.platform === 'darwin') {
    const macDir = fs.readdirSync(DIST_DIR).find((d) => d === 'mac' || d.startsWith('mac-'));
    if (!macDir) return null;
    const appBundle = fs
      .readdirSync(path.join(DIST_DIR, macDir))
      .find((d) => d.endsWith('.app'));
    if (!appBundle) return null;
    const contents = path.join(DIST_DIR, macDir, appBundle, 'Contents');
    const macOsDir = path.join(contents, 'MacOS');
    const bin = fs.existsSync(macOsDir) ? fs.readdirSync(macOsDir)[0] : undefined;
    if (!bin) return null;
    return {
      executablePath: path.join(macOsDir, bin),
      resourcesPath: path.join(contents, 'Resources'),
    };
  }

  const unpacked = path.join(DIST_DIR, 'linux-unpacked');
  if (!fs.existsSync(unpacked)) return null;
  const bin = fs
    .readdirSync(unpacked)
    .find((f) => !f.includes('.') && fs.statSync(path.join(unpacked, f)).isFile());
  if (!bin) return null;
  return {
    executablePath: path.join(unpacked, bin),
    resourcesPath: path.join(unpacked, 'resources'),
  };
}

/**
 * Read an asar archive's directory header without shelling out to the `asar`
 * CLI (awkward to invoke portably from a test). Header layout:
 *
 *   [0..3]   uint32 = 4  (size of the size field)
 *   [4..7]   uint32 = pickle size
 *   [8..11]  uint32 = payload size
 *   [12..15] uint32 = JSON byte length
 *   [16..]   JSON   = { files: { name: { files } | { size, offset } } }
 */
function readAsarHeader(asarPath: string): { files?: Record<string, unknown> } {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, 16, 0);
    const jsonLen = prefix.readUInt32LE(12);
    const json = Buffer.alloc(jsonLen);
    fs.readSync(fd, json, 0, jsonLen, 16);
    return JSON.parse(json.toString('utf8')) as { files?: Record<string, unknown> };
  } finally {
    fs.closeSync(fd);
  }
}

/** True if `segments` names a file (not a directory) inside the archive. */
function asarHasFile(asarPath: string, segments: string[]): boolean {
  let node = readAsarHeader(asarPath);
  for (let i = 0; i < segments.length; i++) {
    const children = node.files;
    if (!children) return false;
    const next = children[segments[i]!] as { files?: Record<string, unknown> } | undefined;
    if (!next) return false;
    if (i === segments.length - 1) return next.files === undefined;
    node = next;
  }
  return false;
}

/** Recursive directory copy. */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Count what the extension managed to write to the probe directory.
 *
 * `BIBLE_EXT_ASAR_PROBE_DIR` is handed to the app as a *negative* control: the
 * fixture has no filesystem access, so a non-zero count means the realm leaked
 * it.
 */
function countFilesIn(dir: string): number {
  try {
    return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
  } catch {
    return 0;
  }
}

async function waitFor<T>(
  fn: () => Promise<T | null> | (T | null),
  timeoutMs: number,
  intervalMs = 400,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** One `ExtensionLogEntry` as returned by `extensions:getLog`. */
interface LogEntry {
  level?: string;
  message?: string;
}

interface ProbeRun {
  /** `extensions:activate` IPC outcome. */
  activate: { ok: boolean; error: string };
  /** Host-side view of the extension after activation. */
  state: { status?: string; lastError?: string } | null;
  /** Host lifecycle log entries (newest first). */
  log: LogEntry[];
  /** Whether the host ever registered the sideloaded extension. */
  registered: boolean;
  /**
   * What the extension reported about its own realm, and the result of its
   * host API round trip. Both arrive over `console.log` -> `__runtime.log` ->
   * `extension.log`, because a sandboxed extension has no other way out - see
   * the fixture's header.
   */
  markers: {
    probe: Record<string, unknown> | null;
    rpc: Record<string, unknown> | null;
  };
  /** pid of the packaged app's MAIN process. */
  mainPid: number;
  /**
   * Files the extension managed to create in `BIBLE_EXT_ASAR_PROBE_DIR`.
   * Must be zero - the pre-sandbox fixture wrote three.
   */
  probeDirFileCount: number;
}

/** Pull a `TAG {json}` line the fixture logged out of the extension's log. */
function taggedLogPayload(log: LogEntry[], tag: string): Record<string, unknown> | null {
  for (const entry of log) {
    const message = entry?.message ?? '';
    const at = message.indexOf(tag + ' ');
    if (at < 0) continue;
    try {
      return JSON.parse(message.slice(at + tag.length + 1)) as Record<string, unknown>;
    } catch {
      /* keep looking - a later entry may be well-formed */
    }
  }
  return null;
}

/** Everything a single packaged-app probe run needs to clean up afterwards. */
interface RunScope {
  installDir: string;
  probeDir: string;
  userDataDir: string;
  app: ElectronApplication | null;
}

const scopes: RunScope[] = [];

/**
 * Sideload an extension into the PACKAGED app, launch it, activate the
 * extension, and collect both host-side and worker-side evidence.
 *
 * `ExtensionHost` uses `join(getDataPath(), 'extensions')`, which in a packaged
 * app is `<resources>/data/extensions`. `loadAll()` auto-registers any valid
 * directory found there with the default-granted permissions
 * (`bible:read`, `commands:register`) - no consent dialog involved.
 */
async function runProbe(
  pkg: PackagedApp,
  extensionId: string,
  populate: (installDir: string) => void,
): Promise<ProbeRun> {
  const installDir = path.join(pkg.resourcesPath, 'data', 'extensions', extensionId);
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
  populate(installDir);

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-ext-asar-probe-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-ext-asar-userdata-'));
  const scope: RunScope = { installDir, probeDir, userDataDir, app: null };
  scopes.push(scope);

  const app = await electron.launch({
    executablePath: pkg.executablePath,
    args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_USER_DATA: userDataDir,
      // Read by the fixture from inside the worker process.
      BIBLE_EXT_ASAR_PROBE_DIR: probeDir,
    },
    timeout: 120_000,
  });
  scope.app = app;

  const window = await app.firstWindow();
  await window
    .waitForSelector('[data-testid="app-loaded"], .bible-pane, [data-testid="bible-pane"]', {
      timeout: 90_000,
    })
    .catch(() => undefined);

  // The extension host boots in the background after the window is shown.
  const registered = await waitFor(async () => {
    const ids = await window.evaluate(async () => {
      const api = (window as unknown as {
        electron?: { extensions?: { list?: () => Promise<unknown> } };
      }).electron;
      if (!api?.extensions?.list) return null;
      try {
        const all = (await api.extensions.list()) as { manifest?: { id?: string } }[];
        return all.map((e) => e.manifest?.id ?? '');
      } catch {
        return null;
      }
    });
    return ids && ids.includes(extensionId) ? true : null;
  }, 60_000);

  // `onStartup` may already have activated it; activate() is idempotent.
  const activate = await window.evaluate(async (id: string) => {
    const api = (window as unknown as {
      electron: { extensions: { activate: (id: string) => Promise<void> } };
    }).electron;
    try {
      await api.extensions.activate(id);
      return { ok: true, error: '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, extensionId);

  const readLog = async (): Promise<LogEntry[]> =>
    window.evaluate(async (id: string) => {
      const api = (window as unknown as {
        electron: { extensions: { getLog: (id: string, limit?: number) => Promise<unknown> } };
      }).electron;
      return (await api.extensions.getLog(id, 200).catch(() => [])) as LogEntry[];
    }, extensionId);

  // The RPC marker is logged from a 300 ms `setTimeout` inside the realm, so
  // poll until it shows up rather than racing it.
  const log =
    (await waitFor(async () => {
      const entries = await readLog();
      return taggedLogPayload(entries, RPC_TAG) ? entries : null;
    }, 25_000)) ?? (await readLog());

  const hostView = await window.evaluate(async (id: string) => {
    const api = (window as unknown as {
      electron: { extensions: { get: (id: string) => Promise<unknown> } };
    }).electron;
    return {
      state: (await api.extensions.get(id).catch(() => null)) as {
        status?: string;
        lastError?: string;
      } | null,
    };
  }, extensionId);

  const mainPid = await app.evaluate(() => process.pid);

  return {
    activate,
    state: hostView.state,
    log,
    registered: registered === true,
    markers: {
      probe: taggedLogPayload(log, PROBE_TAG),
      rpc: taggedLogPayload(log, RPC_TAG),
    },
    mainPid,
    probeDirFileCount: countFilesIn(probeDir),
  };
}

function describeRun(run: ProbeRun): string {
  return (
    `\n  registered: ${run.registered}` +
    `\n  activate IPC: ${JSON.stringify(run.activate)}` +
    `\n  host state: ${JSON.stringify(run.state)}` +
    `\n  host log: ${JSON.stringify(run.log, null, 2)}` +
    `\n  worker markers: ${JSON.stringify(run.markers, null, 2)}`
  );
}

const packaged = findPackagedApp();

test.describe('Extension host inside app.asar (packaged build)', () => {
  // Each test launches a full packaged Electron app; keep them off each
  // other's toes rather than relying on the config's fullyParallel setting.
  test.describe.configure({ mode: 'serial' });

  test.skip(
    packaged === null,
    'No packaged build found under apps/desktop/dist. Build one with ' +
      '`npm run build` (repo root) then `npx electron-builder --win --dir` in ' +
      'apps/desktop. A dev build does NOT use asar and cannot answer this.',
  );

  // Launching a ~190 MB packaged binary and booting the whole app is slow.
  test.setTimeout(240_000);

  test.afterEach(async () => {
    while (scopes.length) {
      const scope = scopes.pop()!;
      if (scope.app) await scope.app.close().catch(() => undefined);
      for (const dir of [scope.installDir, scope.probeDir, scope.userDataDir]) {
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('worker entry script is inside app.asar and not unpacked', async () => {
    const pkg = packaged!;
    const asarPath = path.join(pkg.resourcesPath, 'app.asar');
    expect(fs.existsSync(asarPath), `app.asar missing at ${asarPath}`).toBe(true);

    expect(
      asarHasFile(asarPath, ['out', 'main', 'extension-runtime', 'index.js']),
      'out/main/extension-runtime/index.js is not inside app.asar — the ' +
        'ExtensionHost worker script must ship in the archive',
    ).toBe(true);

    // If it were unpacked, the rest of this file would not be testing anything.
    expect(
      fs.existsSync(
        path.join(pkg.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'extension-runtime'),
      ),
      'extension-runtime is unpacked — these tests no longer cover the asar path',
    ).toBe(false);
  });

  test('utilityProcess worker spawns from inside app.asar and round-trips RPC', async () => {
    const pkg = packaged!;

    const run = await runProbe(pkg, INLINE_EXTENSION_ID, (installDir) => {
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(
        path.join(installDir, 'extension.json'),
        JSON.stringify(inlineManifest(), null, 2),
        'utf8',
      );
    });

    expect(run.registered, `sideloaded extension was never registered${describeRun(run)}`).toBe(
      true,
    );

    // `status: active` is only reached after the worker replies to the host's
    // `runtime.init` request - host -> worker -> host over the utilityProcess
    // message port, with the worker's code coming out of app.asar.
    expect(run.activate.ok, `extensions:activate rejected${describeRun(run)}`).toBe(true);
    expect(run.state?.status, `host should report the extension active${describeRun(run)}`).toBe(
      'active',
    );

    // Evidence produced by code executing INSIDE the realm, inside the utility
    // process. The extension cannot report its own pid or argv any more - it
    // has no `process` - so the proof that the asar-resident worker script ran
    // is that a realm exists at all and answered.
    const probe = run.markers.probe;
    expect(
      probe,
      `activate() never ran inside the realm — the utilityProcess forked from ` +
        `app.asar did not execute${describeRun(run)}`,
    ).not.toBeNull();
    expect(probe!.require, `require() must be denied inside the realm${describeRun(run)}`).toBe(
      'denied',
    );
    expect(probe!.typeofProcess).toBe('undefined');

    // Full worker -> host -> worker round trip (not merely a spawn).
    const rpc = run.markers.rpc as { ok?: boolean; value?: unknown; error?: string } | null;
    expect(rpc, `worker never completed a host API round trip${describeRun(run)}`).not.toBeNull();
    expect(rpc!.ok, `storage round trip failed: ${rpc?.error}${describeRun(run)}`).toBe(true);
    expect(rpc!.value, `storage round trip returned the wrong value${describeRun(run)}`).toBe(
      'round-trip-ok',
    );
  });

  /**
   * An ordinary on-disk extension (`main: "./main.js"`, the only form the
   * manifest validator accepts) must load in the worker.
   *
   * `ExtensionRuntime.init()` has to resolve `manifest.main` against the
   * extension's `installPath`, or the relative specifier resolves against the
   * runtime bundle inside app.asar instead. The host ships `installPath` in the
   * init payload and the worker resolves + containment-checks the entry point
   * against it (`extension-runtime/resolveEntry.ts`).
   */
  test('on-disk extension entry point (manifest.main) loads in the worker', async () => {
    const pkg = packaged!;

    const run = await runProbe(pkg, ONDISK_EXTENSION_ID, (installDir) => {
      copyDir(FIXTURE_DIR, installDir);
    });

    expect(run.registered, `sideloaded extension was never registered${describeRun(run)}`).toBe(
      true,
    );

    // Bug A bit here: the worker resolved "./main.js" against the runtime
    // bundle inside app.asar instead of the extension's install directory.
    // Resolution now happens in the supervisor, which reads the file rather
    // than importing it, but the containment check is the same one.
    expect(
      run.markers.probe,
      `the worker never loaded and ran the extension's main.js${describeRun(run)}`,
    ).not.toBeNull();
    expect(run.state?.status, `host should report the extension active${describeRun(run)}`).toBe(
      'active',
    );

    const rpc = run.markers.rpc as { ok?: boolean; value?: unknown } | null;
    expect(rpc?.ok, `storage round trip failed${describeRun(run)}`).toBe(true);
    expect(rpc?.value).toBe('round-trip-ok');
  });

  /**
   * The acceptance criterion for the sandbox track, in the packaged build.
   *
   * Before the QuickJS realm this same fixture obtained `fs` and wrote files
   * outside the app - with no permission granting it, and no way for a user to
   * know. Everything below must now be denied, and the denial has to hold in
   * the *packaged* app, because that is where extensions actually run.
   */
  test('a packaged extension cannot reach Node, the filesystem, or the host realm', async () => {
    const pkg = packaged!;

    const run = await runProbe(pkg, ONDISK_EXTENSION_ID, (installDir) => {
      copyDir(FIXTURE_DIR, installDir);
    });

    const probe = run.markers.probe;
    expect(probe, `the probe never reported${describeRun(run)}`).not.toBeNull();

    // The headline: outside the realm this call hands back the real `fs` module.
    expect(probe!.require, `require('fs') must be denied${describeRun(run)}`).toBe('denied');
    expect(String(probe!.requireError)).toMatch(/sandboxed realm|self-contained|single file/i);

    // The negative control. `BIBLE_EXT_ASAR_PROBE_DIR` is where the fixture would
    // write `loaded.json`, `activated.json` and `rpc.json` if it could reach the
    // filesystem, which it has no permission to do. It must be untouched.
    expect(
      run.probeDirFileCount,
      `the extension wrote to the filesystem — the realm is not containing it${describeRun(run)}`,
    ).toBe(0);

    // Nothing else ambient is reachable either.
    expect(probe!.typeofProcess).toBe('undefined');
    expect(probe!.typeofFetch).toBe('undefined');
    expect(probe!.typeofBuffer).toBe('undefined');
    expect(probe!.typeofXHR).toBe('undefined');
    expect(probe!.typeofWebAssembly).toBe('undefined');

    // `Function('return this')()` yields the realm's global, not the host's.
    expect(probe!.escapedGlobalHasProcess).toBe(false);
    expect(probe!.escapedGlobalHasRequire).toBe(false);

    // ...and the realm is still a working JavaScript environment. A sandbox
    // that denied everything by breaking the language would be no use.
    expect(probe!.dateWorks).toBe(true);
    expect(probe!.jsonWorks).toBe(true);
    expect(run.state?.status, `the extension should still activate${describeRun(run)}`).toBe(
      'active',
    );
  });
});
