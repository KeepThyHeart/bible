#!/usr/bin/env node
/**
 * Regenerates apps/desktop/test-fixtures/beta1/ from the REAL 0.1.0-beta.1 code.
 *
 *   node apps/desktop/scripts/fixtures/generate-beta1-profile.mjs [commit]
 *
 * `commit` defaults to c0ba3b62 (the commit the annotated tag v0.1.0-beta.1
 * points at; a stale local lightweight tag points at its parent, so we do not
 * use the tag name). The script:
 *   1. `git archive`s that commit's desktop electron sources and core sources
 *      into the gitignored apps/desktop/.fixture-build/beta1/,
 *   2. bundles beta1-profile-entry.mjs with esbuild (aliasing @bible/core and
 *      stubbing electron / electron-log) so beta.1's own schema and backup
 *      code runs, against the working tree's better-sqlite3,
 *   3. writes beta1-user.sql, beta1-backup.zip and beta1-backup.manifest.json.
 *
 * beta1-session.json is hand-authored (beta.1's session serializers need the
 * renderer stores) and is only read here, to seed the autosave row.
 * Beta.1 is frozen, so regeneration is rare; the output is committed.
 * Needs a native better-sqlite3 built for this Node (what vitest uses).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..', '..');
const repo = resolve(desktop, '..', '..');
const commit = process.argv[2] || 'c0ba3b62';
const buildDir = join(desktop, '.fixture-build', 'beta1');
const outDir = join(desktop, 'test-fixtures', 'beta1');

execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repo, stdio: 'inherit' });
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const archive = execFileSync('git', ['archive', commit, 'apps/desktop/electron', 'packages/core/src'], { cwd: repo, maxBuffer: 1 << 30 });
execFileSync('tar', ['-x', '-C', buildDir], { input: archive });

const stubDir = join(buildDir, '_stubs');
mkdirSync(stubDir);
writeFileSync(join(stubDir, 'electron.js'), "export const app = { getPath: () => process.env.TMPDIR || '/tmp', isPackaged: false }; export const dialog = {}; export default { app, dialog };\n");
writeFileSync(join(stubDir, 'log.js'), "const l = { info() {}, warn() {}, error() {}, debug() {} }; export default l;\n");

const bundle = join(buildDir, 'entry.bundle.mjs');
await build({
  entryPoints: [join(here, 'beta1-profile-entry.mjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['better-sqlite3'],
  nodePaths: [join(desktop, 'node_modules'), join(repo, 'packages', 'core', 'node_modules'), join(repo, 'node_modules')],
  alias: {
    '@bible/core': join(buildDir, 'packages/core/src/index.ts'),
    electron: join(stubDir, 'electron.js'),
    'electron-log': join(stubDir, 'log.js'),
    'electron-log/main': join(stubDir, 'log.js'),
  },
  // the entry's relative imports are written against the extracted tree layout
  plugins: [{
    name: 'beta1-root',
    setup(b) {
      b.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/apps\/desktop\// }, (args) => ({
        path: resolve(buildDir, args.path.replace(/^(\.\.\/)+/, '')).replace(/(\.ts)?$/, '.ts'),
      }));
    },
  }],
  logLevel: 'warning',
});
const sessionJson = join(outDir, 'beta1-session.json');
if (!existsSync(sessionJson)) throw new Error(`${sessionJson} is missing (hand-authored input)`);
execFileSync('node', [bundle, outDir, sessionJson], { cwd: desktop, stdio: 'inherit' });
