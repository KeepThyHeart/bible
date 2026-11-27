#!/usr/bin/env node
/**
 * check-lazy-imports - loads the BUILT main bundle's lazy modules the way the
 * app does at run time (real `import()` / `require`, no mocks), inside real
 * Electron, and asserts the members the app uses actually resolve.
 *
 * Why: 1.0.0-beta.1/beta.2 shipped with `await import('electron-updater')` in a
 * CommonJS bundle. Node could not see electron-updater's `autoUpdater` export
 * (see electron/services/updaterLoader.ts), so "Download & Update" failed at
 * run time, and the Vitest mocks (which have the named export) stayed green.
 *
 * What it checks, against `out/main` (build first: `pnpm run build`):
 *   1. Every bare-specifier `import('x')` in the bundle has an entry in
 *      PROBES (unknown ones fail: vet them, then add one).
 *   2. For each, `import('x')` succeeds, and every member the bundle reads
 *      straight off the namespace (`const { a, b } = await import('x')`,
 *      `(await import('x')).A`) is present on the real namespace.
 *   3. `electron-updater`, which the bundle `require()`s, yields a real
 *      `autoUpdater` with autoDownload / checkForUpdates / downloadUpdate /
 *      quitAndInstall, found the way the app finds it (named, else `default`).
 *   4. No `import('electron-updater')` has crept back into the bundle.
 *
 * Usage: node scripts/check-lazy-imports.mjs [--bundle=out/main]
 * Run under plain Node it re-launches itself inside Electron (headless: uses
 * xvfb-run when there is no DISPLAY). `--node-only` skips Electron (weaker:
 * `electron` and the autoUpdater getter cannot be exercised) for machines with
 * no Electron binary.
 *
 * Exit code 0 = all good; 1 = a check failed; 2 = could not run.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const bundleDir = path.resolve(desktopDir, arg('bundle') ?? 'out/main');
const nodeOnly = process.argv.includes('--node-only');

const UPDATER_MEMBERS = ['checkForUpdates', 'downloadUpdate', 'quitAndInstall'];

/**
 * Specifiers the bundle may `import()` lazily, each with extra members to
 * assert beyond those the scan finds. Add an entry only after checking the
 * package's real namespace here. Keep in step with ALLOWED_DYNAMIC_IMPORTS in
 * electron/__tests__/lazyImportGuard.test.ts.
 */
const PROBES = {
  electron: { electronOnly: true, members: ['app', 'net', 'systemPreferences'] },
  unzipper: { members: ['Open'] },
  '@huggingface/transformers': { members: ['pipeline', 'env'] },
  // extension-runtime reads `ns.default ?? ns` (a CommonJS variant, `{default: variant}` under ESM interop), so
  // instead of member names, prove the thing it does with it: boot a QuickJS module and evaluate code.
  '@jitl/quickjs-singlefile-cjs-release-sync': {
    members: [],
    async check(ns) {
      const core = createRequire(path.join(desktopDir, 'package.json'))('quickjs-emscripten-core');
      const base = ns.default ?? ns;
      const wasm = await core.newQuickJSWASMModuleFromVariant(core.newVariant(base, {}));
      const result = wasm.evalCode('1 + 2');
      if (result !== 3) throw new Error(`QuickJS evalCode returned ${result}, expected 3`);
    },
  },
};
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function bundleFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : bundleFiles(full);
    return name.endsWith('.js') ? [full] : [];
  });
}

/** specifier -> Set of members the bundle reads directly off its namespace. */
function scanBundle(files) {
  const found = new Map();
  const add = (spec, members = []) => {
    if (!found.has(spec)) found.set(spec, new Set());
    members.forEach((m) => found.get(spec).add(m));
  };
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/import\(\s*["']([^"'.][^"']*)["']\s*\)/g)) add(m[1]);
    // const { a, b: c } = await import("x")
    for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g)) {
      add(m[2], m[1].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean));
    }
    // (await import("x")).Name
    for (const m of code.matchAll(/\(\s*await\s+import\(\s*["']([^"']+)["']\s*\)\s*\)\.(\w+)/g)) add(m[1], [m[2]]);
  }
  return found;
}

async function runChecks() {
  const failures = [];
  const ok = [];
  const inElectron = Boolean(process.versions.electron);
  const files = bundleFiles(bundleDir);
  if (files.length === 0) {
    console.error(`No bundle found in ${bundleDir}; run \`pnpm run build\` first.`);
    return 2;
  }
  const found = scanBundle(files);
  const requireFromBundle = createRequire(path.join(bundleDir, 'index.js'));

  for (const [spec, scanned] of [...found].sort()) {
    if (BUILTINS.has(spec)) continue;
    if (spec.startsWith('@bible/')) continue; // bundled workspace code, not a runtime lookup
    const probe = PROBES[spec];
    if (probe && probe.members.length === 0 && !probe.check && !scanned.size) {
      failures.push(`PROBES entry for '${spec}' asserts nothing: list the members used, or add a check()`);
      continue;
    }
    if (spec === 'electron-updater') {
      failures.push(`bundle contains import('electron-updater'); load it with require() via updaterLoader.pickExport`);
      continue;
    }
    if (!probe) {
      failures.push(`import('${spec}') in the bundle has no entry in PROBES (scripts/check-lazy-imports.mjs): vet it, then add one`);
      continue;
    }
    if (probe.electronOnly && !inElectron) {
      ok.push(`${spec}: skipped (needs Electron)`);
      continue;
    }
    let ns;
    try {
      ns = await import(spec); // bare specifier: the same ESM resolution the bundle's import() gets
    } catch (err) {
      failures.push(`import('${spec}') threw: ${err?.message ?? err}`);
      continue;
    }
    const target = ns;
    for (const member of new Set([...scanned, ...probe.members])) {
      if (!(member in target) || target[member] === undefined) failures.push(`import('${spec}') namespace has no '${member}' (exports: ${Object.keys(target).slice(0, 8).join(', ')}...)`);
    }
    if (probe.check) {
      try {
        await probe.check(ns);
      } catch (err) {
        failures.push(`import('${spec}') check failed: ${err?.message ?? err}`);
      }
    }
    ok.push(`${spec}: ${[...new Set([...scanned, ...probe.members])].join(', ')}`);
  }

  // electron-updater is require()d by the bundle; resolve the same way.
  if (inElectron) {
    try {
      const mod = requireFromBundle('electron-updater');
      const updater = mod.autoUpdater ?? mod.default?.autoUpdater;
      if (!updater) throw new Error('no autoUpdater on the module or its default');
      if (!('autoDownload' in updater)) throw new Error("autoUpdater has no 'autoDownload'");
      updater.autoDownload = false; // the exact write that failed in beta.2
      for (const m of UPDATER_MEMBERS) {
        if (typeof updater[m] !== 'function') throw new Error(`autoUpdater.${m} is not a function`);
      }
      ok.push(`electron-updater: autoUpdater.{autoDownload,${UPDATER_MEMBERS.join(',')}}`);
    } catch (err) {
      failures.push(`require('electron-updater'): ${err?.message ?? err}`);
    }
  } else {
    // Weaker plain-Node check: the namespace must not be relied on for autoUpdater, and `default` must carry it.
    const ns = await import('electron-updater');
    const desc = Object.getOwnPropertyDescriptor(ns.default ?? {}, 'autoUpdater');
    if (!desc) failures.push("electron-updater's default export has no autoUpdater property");
    else ok.push('electron-updater: autoUpdater present on default (plain-Node check only)');
  }

  ok.forEach((line) => console.log(`ok    ${line}`));
  failures.forEach((line) => console.error(`FAIL  ${line}`));
  console.log(failures.length ? `\n${failures.length} lazy-import check(s) failed.` : '\nAll lazy-import checks passed.');
  return failures.length ? 1 : 0;
}

if (process.versions.electron) {
  // Inside Electron: run, then exit with the result.
  const { app } = await import('electron');
  const code = await runChecks().catch((err) => { console.error(err); return 2; });
  app.exit(code);
} else if (nodeOnly) {
  process.exit(await runChecks());
} else {
  let electronBin;
  try {
    electronBin = createRequire(path.join(desktopDir, 'package.json'))('electron');
  } catch {
    if (process.env.CI) {
      console.error('Electron is not installed (pnpm run init:electron); refusing the weaker --node-only check in CI.');
      process.exit(2);
    }
    console.error('Electron is not installed (pnpm run init:electron); falling back to --node-only.');
    process.exit(await runChecks());
  }
  const base = [electronBin, ['--no-sandbox', '--disable-gpu', ...(process.platform === 'linux' ? ['--ozone-platform=headless'] : []), fileURLToPath(import.meta.url), ...process.argv.slice(2)]];
  const useXvfb = !process.env.DISPLAY && process.platform === 'linux';
  const [cmd, args] = useXvfb ? ['xvfb-run', ['-a', base[0], ...base[1]]] : base;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // deleted, not blanked: Windows may count an empty value as set
  // A timeout so a hung import fails the build instead of stalling it.
  const run = (c, a) => spawnSync(c, a, { stdio: 'inherit', cwd: desktopDir, env, timeout: 180000 });
  let res = run(cmd, args);
  // No xvfb-run installed: try Electron directly (works wherever a display or a headless Electron exists).
  if (res.error?.code === 'ENOENT' && useXvfb) res = run(base[0], base[1]);
  if (res.error) { console.error(`Could not run ${cmd}: ${res.error.message}${res.error.code === 'ETIMEDOUT' ? ' (timed out)' : ''}`); process.exit(2); }
  process.exit(res.status ?? 2);
}
