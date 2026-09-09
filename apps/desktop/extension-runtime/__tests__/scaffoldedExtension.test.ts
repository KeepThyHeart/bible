/**
 * @vitest-environment node
 *
 * Acceptance - what `create-bible-extension` emits actually runs.
 *
 * The scaffolder and the realm are the two ends of the same contract, and they
 * live in different packages, so nothing else checks that they agree. This
 * test closes that loop the only way that proves anything: it runs the real
 * CLI into a temp directory, builds the result with the `esbuild.config.mjs`
 * the CLI wrote, and loads the resulting bundle into a real QuickJS realm.
 *
 * It is deliberately end-to-end rather than a set of assertions about template
 * strings. A template can say `format: 'cjs'` and still be wrong; only loading
 * the artifact shows whether the realm accepts it.
 *
 * The dependency on `packages/create-extension` is a subprocess call to its
 * built CLI, not an import - desktop does not depend on the scaffolder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { build } from 'esbuild';

import type { Extensions } from '@bible/core';
import { QuickJSRealm } from '../host/QuickJSRealm';
import { buildGuestBundle } from './guestBundle';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;

const SCAFFOLDER_ROOT = resolve(__dirname, '../../../../packages/create-extension');
const SCAFFOLDER_CLI = join(SCAFFOLDER_ROOT, 'dist', 'index.js');

const EXT_NAME = 'sample-tools';

let workDir: string;
let projectDir: string;
let guestBundle: string;

beforeAll(async () => {
  guestBundle = await buildGuestBundle();

  // The CLI ships compiled. Build it if this checkout has not been built yet,
  // so the test is self-sufficient rather than silently order-dependent.
  if (!existsSync(SCAFFOLDER_CLI)) {
    execFileSync('npx', ['tsc'], { cwd: SCAFFOLDER_ROOT, shell: true, stdio: 'pipe' });
  }

  workDir = mkdtempSync(join(tmpdir(), 'bible-scaffold-'));
  execFileSync(process.execPath, [SCAFFOLDER_CLI, EXT_NAME], { cwd: workDir, stdio: 'pipe' });
  projectDir = join(workDir, EXT_NAME);
}, 120_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/**
 * Build the scaffolded project the way `npm run build` would, but by reading
 * the options out of the emitted `esbuild.config.mjs` rather than restating
 * them. Running the file itself would need a real `npm install` in the temp
 * directory; parsing the options keeps the test honest about *which* options
 * are under test without paying for one.
 */
async function buildScaffoldedExtension(): Promise<string> {
  const configSource = readFileSync(join(projectDir, 'esbuild.config.mjs'), 'utf8');

  // Fail loudly if the config drifts away from what the realm requires, since
  // the options below are only meaningful if they mirror the emitted file.
  expect(configSource).toMatch(/format:\s*'cjs'/);
  expect(configSource).toMatch(/platform:\s*'neutral'/);
  expect(configSource).toMatch(/entryPoints:\s*\['src\/main\.ts'\]/);

  const result = await build({
    absWorkingDir: projectDir,
    entryPoints: ['src/main.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    target: 'es2020',
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no bundle for the scaffolded extension');
  return out.text;
}

interface Driver {
  sent: RpcEnvelope[];
  requests(): RpcRequest[];
  runtimeErrors(): { source: string; message: string }[];
  settle(handlers: Record<string, (args: unknown[]) => unknown>): void;
  dispose(): void;
}

async function loadIntoRealm(bundleSource: string): Promise<Driver> {
  const sent: RpcEnvelope[] = [];
  const realm = await QuickJSRealm.create({
    extensionId: 'ext.your-name.sample-tools',
    guestBundleSource: guestBundle,
    loadEntryBundle: () => ({ source: bundleSource, filename: 'sample-tools/main.js' }),
    onSend: (env) => sent.push(env as RpcEnvelope),
    onLog: () => {},
    onFatal: () => {},
  });

  realm.deliver({
    kind: 'request',
    id: 'host-init',
    method: 'runtime.init',
    args: [
      {
        manifest: JSON.parse(readFileSync(join(projectDir, 'extension.json'), 'utf8')),
        installPath: projectDir,
        grantedPermissions: ['bible:read'],
        hostApiVersion: '1.0.0',
        hostMinSupportedApiVersion: '1.0.0',
        locale: 'en',
        hostFeatures: [],
      },
    ],
  });

  const answered = new Set<string>();
  return {
    sent,
    requests: () => sent.filter((e): e is RpcRequest => e.kind === 'request'),
    runtimeErrors: () =>
      sent
        .filter((e) => e.kind === 'event' && e.channel === '__runtime.error')
        .map((e) => (e as Extensions.RpcEvent).payload as { source: string; message: string }),
    settle(handlers) {
      for (let round = 0; round < 50; round++) {
        const outstanding = sent.filter(
          (e): e is RpcRequest => e.kind === 'request' && !answered.has(e.id),
        );
        if (outstanding.length === 0) return;
        for (const req of outstanding) {
          answered.add(req.id);
          const handler = handlers[req.method];
          realm.deliver(
            handler
              ? { kind: 'response', id: req.id, result: handler(req.args) }
              : {
                  kind: 'response',
                  id: req.id,
                  error: { code: 'RpcProtocolError', message: `Unknown: ${req.method}` },
                },
          );
        }
      }
      throw new Error('guest did not settle after 50 rounds');
    },
    dispose: () => realm.dispose(),
  };
}

describe('create-bible-extension output loads in the realm', () => {
  it('scaffolds the files the build and the realm both need', () => {
    for (const file of [
      'extension.json',
      'package.json',
      'tsconfig.json',
      'esbuild.config.mjs',
      'src/main.ts',
      'src/verseUtils.ts',
      'src/bible-env.d.ts',
    ]) {
      expect(existsSync(join(projectDir, file)), file).toBe(true);
    }
  });

  it('configures TypeScript for the realm rather than for Node', () => {
    const tsconfig = JSON.parse(readFileSync(join(projectDir, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };
    // `types: ['node']` would let `process.env` and `require` typecheck in code
    // that cannot possibly run, which is the failure this guards against.
    expect(tsconfig.compilerOptions.types).toEqual([]);
    expect(tsconfig.compilerOptions.lib).toEqual(['ES2020']);
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
  });

  it('bundles multi-file source into a single CommonJS artifact', async () => {
    const bundle = await buildScaffoldedExtension();
    // The second source module is inlined, not required at runtime.
    expect(bundle).toContain('describeVerse');
    expect(bundle).not.toMatch(/require\(['"]\.\/verseUtils['"]\)/);
    // CJS, not ESM - `export` syntax would not parse inside the realm wrapper.
    expect(bundle).not.toMatch(/^export\s/m);
  });

  it('activates in a real realm and reaches the host API', async () => {
    const bundle = await buildScaffoldedExtension();
    const d = await loadIntoRealm(bundle);
    try {
      d.settle({
        'ui.registerPanelType': () => ({ id: 'ext.your-name.sample-tools.panel' }),
        // `api.panels.onMessage` binds its handler in the worker's own
        // endpoint table AND tells the host a handler now exists, so it awaits
        // a real round trip. Leave it unsettled and activation parks here
        // forever - the panel registration above lands, and nothing after this
        // line in the template ever runs, which reads as "the scaffold stopped
        // subscribing to verse changes" rather than as a stalled promise.
        'panels.setMessageHandler': () => undefined,
      });

      // The template registers its declared panel type during activate()...
      const panel = d.requests().find((r) => r.method === 'ui.registerPanelType');
      expect(panel).toBeDefined();

      // ...as a definition object carrying the SHORT id, not a qualified
      // string. `handleRegisterPanelType` takes the def's `id` verbatim and
      // `RendererUiBridge` keys the panel as `${extensionId}.${panelTypeId}`,
      // so passing the fully-qualified id here produces
      // `ext:ext.a.b.ext.a.b.panel` - the extension's own prefix, twice. This
      // assertion previously pinned the older, wrong shape.
      expect(panel!.args[0]).toEqual(
        expect.objectContaining({ id: 'panel', uiEntry: 'ui/index.html' }),
      );

      // ...and subscribes to the verse-change channel.
      const subscribe = d.sent.find((e) => e.kind === 'subscribe');
      expect((subscribe as Extensions.RpcSubscribe | undefined)?.channel).toBe(
        'bible.onDidChangeActiveVerse',
      );

      // Activation reported success and nothing threw on the way.
      const ack = d.sent.find((e) => e.kind === 'response' && e.id === 'host-init');
      expect((ack as Extensions.RpcResponse | undefined)?.error).toBeUndefined();
      expect(d.runtimeErrors()).toEqual([]);
    } finally {
      d.dispose();
    }
  });

  it('fails the build when source reaches for a Node built-in', async () => {
    // The `platform: 'neutral'` tripwire. Without it this compiles happily and
    // the author only learns at runtime, inside a realm, that `fs` is not a
    // thing - and the error there is far less legible than this one.
    const mainPath = join(projectDir, 'src', 'main.ts');
    const original = readFileSync(mainPath, 'utf8');
    writeFileSync(mainPath, `import * as fs from 'fs';\nvoid fs;\n${original}`, 'utf8');
    try {
      await expect(buildScaffoldedExtension()).rejects.toThrow(/Could not resolve "fs"/);
    } finally {
      writeFileSync(mainPath, original, 'utf8');
    }
  });
});
