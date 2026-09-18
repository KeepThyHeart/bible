#!/usr/bin/env node
/**
 * Scaffold a new Bible app extension project.
 *
 * Usage:
 *   npx @bible/create-extension my-extension
 *   # or
 *   create-bible-extension my-extension
 *
 * Creates a directory with a complete extension project template including
 * manifest, TypeScript config, entry point, test setup, and README.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Template content ─────────────────────────────────────────────────────────

function manifestTemplate(id: string, name: string): string {
  return JSON.stringify(
    {
      // Resolved relative to this file, so editors validate `extension.json`
      // as you type it — completions for `permissions`, `activationEvents` and
      // every contribution point. This was a `https://bible-app.dev/...` URL
      // that resolves nowhere, which silently bought no validation at all.
      // The schema arrives with @bible/core, so it works after `npm install`.
      $schema: './node_modules/@bible/core/dist/Extensions/ExtensionManifestSchema.json',
      id: `ext.your-name.${id}`,
      name,
      version: '0.1.0',
      publisher: 'your-name',
      description: `A Bible app extension: ${name}`,
      engines: { bibleApp: '>=1.0.0' },
      main: 'dist/main.js',
      permissions: ['bible:read'],
      activationEvents: ['onStartup'],
      contributes: {
        commands: [
          {
            id: `ext.your-name.${id}.helloWorld`,
            title: `${name}: Hello World`,
            handlerEndpoint: 'helloWorld',
          },
        ],
        panelTypes: [
          {
            // Short id. The validator qualifies it to
            // `ext.your-name.<ext>.panel` for you, and it is the same id
            // src/main.ts passes to api.ui.registerPanelType — where a
            // pre-qualified id would be prefixed a second time.
            id: 'panel',
            title: `${name}`,
            uiEntry: 'ui/index.html',
            defaultBucket: 'right',
          },
        ],
      },
    },
    null,
    2,
  );
}

function entryPointTemplate(name: string): string {
  return `// \`import type\` is erased at build time, so this costs nothing in the
// bundle and creates no runtime dependency on @bible/core — you get the full
// typed API surface, and dist/main.js stays your own code.
import type { Extensions } from '@bible/core';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;

// Split your code across as many files as you like — esbuild inlines them all
// into the single dist/main.js the host loads. What you cannot do is import a
// Node built-in ('fs', 'path', 'crypto', …): the build is configured to fail
// on those, because the realm your extension runs in has none of them.
import { describeVerse } from './verseUtils';

/** The most recent active verse, kept between calls. See the command below. */
let lastVerseId: number | null = null;

/**
 * Called when the extension is activated.
 * Register commands, panels, and event listeners here.
 */
export async function activate(api: BibleExtensionAPI): Promise<void> {
  // console.* is routed to the host and lands in your extension's log, which
  // you can read from the app's extension details view.
  console.log('${name} extension activated');

  // Declaring a panel in extension.json is NOT enough to make it appear.
  // Despite what the manifest's own doc comments suggest, nothing in the host
  // currently reads \`contributes.panelTypes\` — the only parts of
  // \`contributes\` anything reads are \`apiExports\` and \`configuration\`.
  // Panels and commands reach the registry through these imperative calls and
  // no other way, so the manifest entry is documentation until that changes.
  //
  // Note the id is the SHORT one ('panel'), not the fully-qualified id in
  // extension.json: the host composes the content type as
  // \`ext:<extensionId>.<this id>\` and would otherwise repeat your prefix.
  await api.ui.registerPanelType({
    id: 'panel',
    title: '${name}',
    uiEntry: 'ui/index.html',
  });

  // THIS is the line that makes the command in extension.json actually do
  // something. A \`handlerEndpoint\` in the manifest is a *name*, not a
  // function — a function cannot survive the RPC hop to the host. The host
  // calls back with that name when the user runs the command, and until
  // something binds it here, the command appears in the palette and the Tools
  // menu and silently does nothing when clicked.
  await api.runtime.expose('helloWorld', async () => {
    if (lastVerseId === null) {
      console.log('Hello from ${name}! No verse is active yet.');
      return;
    }
    // There is no api.bible.getActiveVerse() — the active verse arrives as an
    // event, so an extension that wants it on demand remembers it. Your worker
    // is a long-lived process, so module state is exactly the right place.
    const verse = await api.bible.getVerse(lastVerseId);
    console.log(\`Hello from ${name}! \${describeVerse(lastVerseId)}: \${verse.text}\`);
  });

  // The other end of ui/index.html's postToWorker. The payload is opaque to
  // the host — this is your own protocol with your own panel — and whatever
  // api.* you call here runs under YOUR permissions, which is why the panel
  // does not get an api of its own.
  await api.panels.onMessage(async (message) => {
    const msg = message as { type?: string };
    if (msg.type !== 'getActiveVerse') return { verse: 'Unknown request' };
    if (lastVerseId === null) return { verse: 'No verse is active yet.' };
    const verse = await api.bible.getVerse(lastVerseId);
    return { verse: \`\${describeVerse(lastVerseId)} — \${verse.text}\` };
  });

  // Example: listen for verse changes. \`event\` needs no annotation — its
  // shape comes from the typed \`api\` above, and so does the autocomplete.
  await api.bible.onDidChangeActiveVerse.subscribe((event) => {
    lastVerseId = event ? event.verseId : null;
    // Push it at the panel too, so an open panel updates without polling.
    // Fire-and-forget: a panel that is not open simply is not there.
    if (lastVerseId !== null) {
      void api.panels.postMessage({ type: 'activeVerse', verse: describeVerse(lastVerseId) });
    }
  });
}

/**
 * Called when the extension is deactivated.
 * Clean up any resources here.
 */
export function deactivate(): void {
  console.log('${name} extension deactivated');
}
`;
}

/**
 * A second source module, so the scaffold demonstrates the thing the packaging
 * rule is easiest to get wrong about: multi-file *source* is fine, it is
 * multi-file *output* that the realm cannot load.
 */
function verseUtilsTemplate(): string {
  return `/**
 * Verse ids are calculated, not looked up:
 *   verseId = (book * 1000000) + (chapter * 1000) + verse
 * So John 3:16 (book 43) is 43003016.
 */
export function describeVerse(verseId: number): string {
  const book = Math.floor(verseId / 1000000);
  const chapter = Math.floor((verseId % 1000000) / 1000);
  const verse = verseId % 1000;
  return \`book \${book}, \${chapter}:\${verse}\`;
}
`;
}

function uiHtmlTemplate(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <h1>Hello from ${name}!</h1>
    <p id="output">Loading…</p>
    <button id="refresh" type="button">Refresh</button>
  </div>

  <!--
    Panel scripts MUST be external files. This document is served on its own
    ext-ui:// origin under "script-src 'self' ext-ui://host" — there is no
    'unsafe-inline', so an inline <script> here is silently blocked with no
    error you will see. (Inline *styles* are allowed; style-src permits them.)

    panel.js talks to your extension's worker — see src/main.ts, which answers
    with api.panels.onMessage. The panel has no api.* of its own by design:
    whatever it needs, it asks the worker for, and the worker's permissions
    are the ones that apply.
  -->
  <script src="panel.js"></script>
</body>
</html>
`;
}

/**
 * The panel side. Bundled by esbuild to `ui/panel.js`, which `ui/index.html`
 * loads as an external script.
 */
function panelTemplate(name: string): string {
  return `import { BibleExtUI } from '@bible/extension-ui';

// init() opens the bridge to the renderer host. Everything below goes through
// it — the panel has no api.* of its own, deliberately: it runs on its own
// sandboxed origin, and giving it a slice of the API would put permission
// decisions in the renderer, which is the least appropriate place for them.
const bible = BibleExtUI.init();

const output = document.getElementById('output');

function show(text: string): void {
  if (output) output.textContent = text;
}

// postToWorker is request/reply, and the other end is api.panels.onMessage in
// src/main.ts. The payload is opaque to the host: it is your protocol with
// your own worker, so keep it small — messages are capped at 256 KB each way,
// because the realm has a bounded heap and unbounded payloads into it would be
// a denial-of-service surface against your own extension.
async function refresh(): Promise<void> {
  try {
    const reply = await bible.postToWorker<{ verse: string }>({ type: 'getActiveVerse' });
    show(reply.verse);
  } catch (err) {
    show(\`Could not reach the extension worker: \${(err as Error).message}\`);
  }
}

// Worker pushes are fire-and-forget in the other direction (api.panels.postMessage).
bible.onWorkerMessage((message) => {
  const msg = message as { type?: string; verse?: string };
  if (msg.type === 'activeVerse' && typeof msg.verse === 'string') show(msg.verse);
});

document.getElementById('refresh')?.addEventListener('click', () => {
  void refresh();
});

void refresh();
console.log('${name} panel ready');
`;
}

function uiStylesTemplate(): string {
  return `/* Extension panel styles */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  padding: 16px;
}

#app {
  max-width: 600px;
}

h1 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

p {
  color: #666;
}
`;
}

function testTemplate(id: string): string {
  return `import { describe, it, expect, vi } from 'vitest';
import {
  createMockApi,
  createTestHost,
  getMockRuntimeEndpoints,
  VERSE_JOHN_3_16,
} from '@bible/extension-testing';
import { activate, deactivate } from '../src/main';

describe('${id} extension', () => {
  it('should activate without errors', async () => {
    const host = createTestHost({ activate, deactivate });
    await host.activate();
    expect(host.isActive()).toBe(true);
    await host.deactivate();
  });

  /**
   * The single most valuable test in this file. Every command in
   * extension.json names a \`handlerEndpoint\`, and the app has no way to tell
   * a handler you forgot to bind from one that binds and does nothing — both
   * put an item in the palette that appears to work. Assert the binding.
   */
  it('binds the handler for every command in extension.json', async () => {
    const api = createMockApi();
    await activate(api);

    expect(getMockRuntimeEndpoints(api).list()).toContain('helloWorld');
  });

  it('runs the helloWorld command without throwing', async () => {
    const api = createMockApi();
    await activate(api);

    await expect(
      getMockRuntimeEndpoints(api).invoke('helloWorld'),
    ).resolves.not.toThrow();
  });

  it('should subscribe to verse change events', async () => {
    const subscribeSpy = vi.fn().mockResolvedValue({ dispose: vi.fn() });
    const api = createMockApi({
      bible: {
        onDidChangeActiveVerse: { subscribe: subscribeSpy },
      },
    });

    await activate(api);

    expect(subscribeSpy).toHaveBeenCalled();
  });

  it('can use test fixtures', () => {
    expect(VERSE_JOHN_3_16.verseId).toBe(43003016);
    expect(VERSE_JOHN_3_16.text).toContain('God so loved');
  });
});
`;
}

function tsconfigTemplate(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        // Authored as ESM, bundled to a single CommonJS file by esbuild — see
        // esbuild.config.mjs. `tsc` never emits here; it only typechecks.
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true,
        // No DOM, and deliberately no `types: ['node']`. Extensions run in a
        // sandboxed realm with no Node built-ins and no browser globals, so
        // pulling in either would let code typecheck that cannot run. What the
        // realm *does* provide is declared in src/bible-env.d.ts.
        lib: ['ES2020'],
        types: [],
        noImplicitAny: true,
        strictNullChecks: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
      },
      include: ['src/**/*'],
      // src/panel.ts runs in the iframe, not the realm. It needs the DOM and
      // must NOT be checked against a config that denies it, so it has its own
      // tsconfig.panel.json.
      exclude: ['node_modules', 'dist', 'src/panel.ts'],
    },
    null,
    2,
  );
}

/**
 * The panel half of an extension is a different runtime with a different set
 * of globals: an ordinary browser document on a sandboxed `ext-ui://` origin,
 * with a DOM and no `api.*` at all. Typechecking it against the realm's config
 * would reject `document`; typechecking the realm against this one would let
 * worker code reference a DOM that does not exist there. Hence two configs.
 */
function tsconfigPanelTemplate(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true,
        lib: ['ES2020', 'DOM'],
        types: [],
        noImplicitAny: true,
        strictNullChecks: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
      },
      include: ['src/panel.ts'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  );
}

/**
 * Ambient declarations for the sandbox realm.
 *
 * This file is the type-level statement of what an extension may use. The
 * realm is a bare QuickJS context: it has the standard JavaScript library
 * (`Object`, `Array`, `Date`, `Math`, `JSON`, `RegExp`, `Promise`, typed
 * arrays…) which `lib: ["ES2020"]` already covers, plus exactly the host
 * bridges below. It has no `process`, no `require`, no `fetch`, no `Buffer`,
 * no `window` and no `document`.
 *
 * Everything else the extension can do goes through the `api` object passed to
 * `activate()`, which is the point: capabilities are granted, not ambient.
 */
function bibleEnvTemplate(): string {
  return `// Generated by create-bible-extension. Describes the sandbox realm
// your extension runs in. Safe to extend, but adding a declaration here does
// not add the capability — the realm has to actually provide it.

/**
 * Routed to the host and written to your extension's log, which you can read
 * from the app's extension details view. There is no stdout in the realm.
 */
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  trace(...args: unknown[]): void;
};

/** Timers are driven by the host; ids are opaque numbers, not Node Timeouts. */
declare function setTimeout(handler: () => void, timeoutMs?: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(handler: () => void, intervalMs?: number): number;
declare function clearInterval(id: number): void;

/** Runs on the realm's own job queue — no host clock involved. */
declare function queueMicrotask(callback: () => void): void;
`;
}

/**
 * The build step. Emitted as a real file rather than a long CLI string in
 * package.json so an author can read it, and so the reasons behind each option
 * are visible at the place they would be changed.
 */
function esbuildConfigTemplate(): string {
  return `import { build, context } from 'esbuild';

/**
 * Extensions load as ONE self-contained file. The host evaluates it inside a
 * sandboxed QuickJS realm that has no module system at all — \`require\` exists
 * only to throw a message telling you to bundle — so anything your entry point
 * imports has to be inlined here at build time.
 */
const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,

  // CommonJS, NOT ESM. The host wraps your bundle in
  // \`(function (exports, module, require) { … })\`, so \`export\` syntax is a
  // parse error inside the realm. Author in ESM; ship CJS.
  format: 'cjs',

  // 'neutral' is a tripwire, and the most useful line in this file: it makes
  // \`import fs from 'fs'\` fail at BUILD time with "Could not resolve", instead
  // of at runtime inside a realm that has no filesystem. If a dependency of
  // yours needs Node built-ins, it cannot run as an extension.
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['import', 'default'],

  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

/**
 * The panel is a SEPARATE build with different rules. It runs in an ordinary
 * browser iframe, so it gets platform: 'browser' and the DOM — and it must be
 * an external file, because the panel document is served under
 * \`script-src 'self' ext-ui://host\` with no 'unsafe-inline'. An inline
 * <script> in ui/index.html is blocked with no visible error.
 *
 * @bible/extension-ui is bundled in here rather than loaded from the host:
 * nothing serves the SDK from the ext-ui://host origin, so the only way a
 * panel can use it is inlined into a file inside the extension package.
 */
const panelOptions = {
  entryPoints: ['src/panel.ts'],
  outfile: 'ui/panel.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctxs = await Promise.all([context(options), context(panelOptions)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('esbuild: watching for changes…');
} else {
  await Promise.all([build(options), build(panelOptions)]);
}
`;
}

function vitestConfigTemplate(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
`;
}

/**
 * Where the scaffold's two SDK devDependencies come from.
 *
 * Until `@bible/core` and `@bible/extension-testing` are on a registry, a
 * project created outside this repository cannot resolve them by version:
 * `npm install` fails on the very first command the README tells an author to
 * run. `--local-sdk=<dir>` points the scaffold at packed tarballs instead
 * (`npm run pack:sdk` in the monorepo produces them), so out-of-tree
 * development works today and the same scaffold keeps working unchanged once
 * the packages are published.
 */
interface SdkSpecs {
  core: string;
  extensionTesting: string;
  extensionUi: string;
}

const REGISTRY_SDK: SdkSpecs = {
  core: '^0.1.0',
  extensionTesting: '^0.1.0',
  extensionUi: '^0.1.0',
};

function resolveLocalSdk(sdkDir: string, targetDir: string): SdkSpecs {
  const resolved = path.resolve(process.cwd(), sdkDir);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: --local-sdk directory does not exist: ${resolved}`);
    process.exit(1);
  }

  const tarballs = fs.readdirSync(resolved).filter((f) => f.endsWith('.tgz'));

  const pick = (prefix: string, packageName: string): string => {
    // Newest last by sort, which for `name-<semver>.tgz` is close enough to
    // version order for a dev-only convenience and is at least deterministic.
    const matches = tarballs.filter((f) => f.startsWith(prefix)).sort();
    const chosen = matches[matches.length - 1];
    if (!chosen) {
      console.error(
        `Error: no ${packageName} tarball (${prefix}*.tgz) in ${resolved}\n` +
          `       Run "npm run pack:sdk" in the Bible repository first.`,
      );
      process.exit(1);
    }
    const rel = path.relative(targetDir, path.join(resolved, chosen)).split(path.sep).join('/');
    return `file:${rel}`;
  };

  return {
    core: pick('bible-core-', '@bible/core'),
    extensionTesting: pick('bible-extension-testing-', '@bible/extension-testing'),
    extensionUi: pick('bible-extension-ui-', '@bible/extension-ui'),
  };
}

function packageJsonTemplate(id: string, name: string, sdk: SdkSpecs): string {
  return JSON.stringify(
    {
      name: `bible-ext-${id}`,
      version: '0.1.0',
      description: `A Bible app extension: ${name}`,
      // The bundle esbuild produces. No `types` field: nothing here is meant
      // to be imported as a library, and `tsc` emits no declarations.
      main: 'dist/main.js',
      scripts: {
        // Typecheck and bundle are separate jobs: `tsc` only checks (noEmit),
        // esbuild produces the single file the host loads.
        build: 'npm run typecheck && node esbuild.config.mjs',
        // Both halves. The realm code and the panel code have different
        // globals, so they have different tsconfigs — see tsconfig.panel.json.
        typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.panel.json',
        watch: 'node esbuild.config.mjs --watch',
        // `rm -rf` is not a command on Windows, where a fair share of authors
        // work. node's own rmSync is the portable spelling.
        clean: 'node -e "require(\'fs\').rmSync(\'dist\',{recursive:true,force:true})"',
        test: 'vitest run',
        'test:watch': 'vitest',
        // Checks the manifest and that every file it points at exists. Cheap
        // enough to run in CI on every push; needs no realm.
        validate: 'bible-ext validate',
        smoke: 'bible-ext-smoke',
        // `bible-ext package`, NOT `npm pack`. npm pack produces a registry
        // tarball; the app installs a .zip with extension.json at the root,
        // and cannot read the former.
        package: 'npm run build && bible-ext package',
      },
      keywords: ['bible', 'extension'],
      license: 'MIT',
      devDependencies: {
        '@bible/core': sdk.core,
        '@bible/extension-testing': sdk.extensionTesting,
        // Bundled into ui/panel.js by esbuild, not loaded at runtime — the
        // panel origin serves only files inside your package.
        '@bible/extension-ui': sdk.extensionUi,
        // @types/node is for the *build scripts* (esbuild.config.mjs), not for
        // your extension: tsconfig sets `types: []` so it never reaches src/.
        '@types/node': '^20.14.0',
        esbuild: '^0.25.0',
        typescript: '^5.5.0',
        vitest: '^2.0.0',
      },
      // No peerDependencies. @bible/core is used for `import type` only — it
      // is erased at build time and never appears in dist/main.js — and the
      // host injects `api` at runtime rather than the extension importing it.
      // Nobody `npm install`s an extension, so a peer range here would only
      // have been a claim with no consumer to honour it.
    },
    null,
    2,
  );
}

function readmeTemplate(id: string, name: string): string {
  return `# ${name}

A Bible app extension.

## How extensions run — read this first

Your extension does **not** run in Node. The app loads it into a sandboxed
QuickJS realm with no ambient authority at all: no \`require\`, no \`process\`,
no \`fetch\`, no \`Buffer\`, no filesystem, no \`window\`. Everything your code can
do arrives through the \`api\` object passed to \`activate()\`, and only what your
manifest's \`permissions\` asked for and the user granted.

Three consequences worth internalising:

1. **One file.** The host evaluates a single bundle. Split your *source* over as
   many modules as you like — \`esbuild.config.mjs\` inlines them — but the
   output is one \`dist/main.js\`.
2. **CommonJS output, ESM source.** The host wraps your bundle in
   \`(function (exports, module, require) { … })\`, so \`export\` syntax in the
   *shipped file* is a parse error. Write \`export function activate\`; esbuild
   converts it. Don't change \`format: 'cjs'\`.
3. **No Node built-ins, including transitively.** The build uses esbuild's
   \`platform: 'neutral'\`, so \`import 'fs'\` — yours or a dependency's — fails at
   build time with "Could not resolve". That is the intended behaviour: a
   dependency that needs Node cannot run as an extension.

\`console.log\` works and is routed to the host; find the output in the app's
extension details view. Timers work. \`Date\`, \`Math\`, \`JSON\`, \`RegExp\`,
\`Promise\` and typed arrays are all native. \`src/bible-env.d.ts\` declares the
realm's globals for TypeScript, and is the authoritative list.

Your extension also gets bounded CPU and memory: a single turn that runs too
long is interrupted, and heap growth is capped. Well-behaved code never
notices; an infinite loop is stopped without taking the app down.

The developer docs cover this in full under **How Extensions Run** (which
globals exist, which do not, and the exact limits) and **Packaging and Build**.

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

\`\`\`bash
npm install
\`\`\`

### Build

\`\`\`bash
npm run build
\`\`\`

### Test

\`\`\`bash
npm test
\`\`\`

### Smoke test

Run \`npm run smoke\` to validate your extension's hooks against the default
corpus (verses, references, storage, network) — see the Bible extension docs
for details.

### Watch mode

\`\`\`bash
# TypeScript watch
npm run watch

# Test watch
npm run test:watch
\`\`\`

## Project Structure

\`\`\`
${id}/
  extension.json      # Extension manifest
  package.json        # npm package config
  tsconfig.json       # TypeScript config (typecheck only — esbuild emits)
  esbuild.config.mjs  # Bundles src/ into the single dist/main.js the host loads
  vitest.config.ts    # Test config
  src/
    main.ts           # Entry point (activate/deactivate)
    verseUtils.ts     # A second module, to show that source can be split
    bible-env.d.ts    # Types for the realm globals (console, timers)
  ui/
    index.html        # Panel UI skeleton
    styles.css        # Panel styling
  test/
    main.test.ts      # Unit tests
\`\`\`

## Extension Manifest

The \`extension.json\` file declares your extension's identity, permissions,
activation events, and contributions (commands, panels, providers, etc.).

Key fields:
- **id**: Unique identifier in the form \`ext.<publisher>.<name>\`
- **engines.bibleApp**: Semver range of compatible API versions
- **main**: Path to the compiled entry point
- **permissions**: Array of permissions your extension needs
- **activationEvents**: When the extension should be activated
- **contributes**: Static declarations (commands, panels, menus, etc.)

## API Usage

Your \`activate(api)\` function receives a \`BibleExtensionAPI\` object with
18 namespaces:

| Namespace    | Description                          |
|-------------|--------------------------------------|
| bible       | Read verses, modules, books          |
| commentary  | Read/provide commentary entries      |
| dictionary  | Look up dictionary/lexicon entries   |
| book        | Read book/devotional sections        |
| notes       | CRUD user notes                      |
| highlights  | CRUD user highlights + custom styles |
| bookmarks   | Manage bookmarks and collections     |
| commands    | Register and execute commands        |
| ui          | Panels, decorators, notifications    |
| workspace   | Panel management                     |
| context     | Read/write context keys              |
| storage     | Key-value, secrets, SQLite database  |
| l10n        | Localization                         |
| events      | Subscribe to host events             |
| network     | Mediated HTTP requests               |
| auth        | OAuth 2.0 flow                       |
| tasks       | Background tasks with progress       |
| extensions  | Inter-extension calls                |
| ai          | AI provider (reserved, v1 stub)      |

## Testing

This project is pre-configured with [\`@bible/extension-testing\`](https://github.com/example/bible)
which provides:

- **\`createMockApi(overrides?)\`** — fully mocked API with all 18 namespaces
- **\`createTestHost({ activate, deactivate })\`** — lifecycle simulation
- **\`fixtures\`** — sample verses, modules, notes, etc.

\`\`\`typescript
import { createMockApi, VERSE_JOHN_3_16 } from '@bible/extension-testing';

const api = createMockApi({
  bible: {
    getVerse: vi.fn().mockResolvedValue(VERSE_JOHN_3_16),
  },
});

await activate(api);
expect(api.bible.getVerse).toHaveBeenCalled();
\`\`\`

## Packaging

\`\`\`bash
npm run package
\`\`\`

This builds and creates a \`.tgz\` file you can install into the Bible app.

## License

MIT, as generated. Change it to whatever you like -- this is your extension.

Nothing here obliges you to any particular licence. The Bible app itself is GPL-3.0-or-later, but the pieces that end up inside your bundle are not: \`@bible/extension-ui\` is MIT, and \`@bible/core\` is used for types only, which the compiler erases at build time. Commercial and closed-source extensions are fine.
`;
}

function gitignoreTemplate(): string {
  return `node_modules/
dist/
build/
ui/panel.js
ui/panel.js.map
*.tgz
.DS_Store
`;
}

/**
 * What `bible-ext package` leaves out of the .zip.
 *
 * Everything here is on top of the built-in exclusions (node_modules/, .git/,
 * *.zip, *.tgz, *.map). These are the scaffold's own additions: the
 * *sources* of the bundle rather than the bundle. Shipping them is harmless
 * but pointless — the host loads dist/main.js and nothing else — and it puts
 * an author's whole tree inside an artifact they may be publishing.
 */
function bibleignoreTemplate(): string {
  return `# Patterns for \`bible-ext package\`. One per line; # for comments.
# A trailing / means "this directory and everything under it".

src/
test/
tsconfig*.json
vitest.config.ts
esbuild.config.mjs
package.json
package-lock.json
README.md
`;
}

// ─── CLI logic ────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Usage: create-bible-extension <name> [options]

Arguments:
  name          Extension name (e.g. "greek-tools", "daily-reading")

Options:
  --local-sdk=<dir>  Resolve @bible/core and @bible/extension-testing from
                     packed tarballs in <dir> instead of a registry. Run
                     "npm run pack:sdk" in the Bible repository to produce
                     them. Needed until those packages are published.
  --help             Show this help message

Examples:
  create-bible-extension greek-tools
  create-bible-extension daily-reading --local-sdk=../bible/build/sdk
  npx @bible/create-extension my-extension
`);
}

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function toTitleCase(input: string): string {
  return input
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const rawName = args.find((a) => !a.startsWith('-'));
  if (!rawName) {
    console.error('Error: Extension name is required.');
    printUsage();
    process.exit(1);
  }

  const localSdkArg = args.find((a) => a.startsWith('--local-sdk'));
  if (localSdkArg !== undefined && !localSdkArg.includes('=')) {
    console.error('Error: --local-sdk requires a directory, e.g. --local-sdk=../bible/build/sdk');
    process.exit(1);
  }

  const id = toKebabCase(rawName);
  const name = toTitleCase(id);
  const targetDir = path.resolve(process.cwd(), id);

  if (fs.existsSync(targetDir)) {
    console.error(`Error: Directory "${id}" already exists.`);
    process.exit(1);
  }

  const sdk =
    localSdkArg !== undefined
      ? resolveLocalSdk(localSdkArg.slice(localSdkArg.indexOf('=') + 1), targetDir)
      : REGISTRY_SDK;

  console.log(`Creating Bible extension "${name}" in ./${id}/\n`);

  // Create directory structure
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'ui'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'test'), { recursive: true });

  // Write files
  const files: Array<[string, string]> = [
    ['extension.json', manifestTemplate(id, name)],
    ['package.json', packageJsonTemplate(id, name, sdk)],
    ['tsconfig.json', tsconfigTemplate()],
    ['tsconfig.panel.json', tsconfigPanelTemplate()],
    ['esbuild.config.mjs', esbuildConfigTemplate()],
    ['vitest.config.ts', vitestConfigTemplate()],
    ['README.md', readmeTemplate(id, name)],
    ['.gitignore', gitignoreTemplate()],
    ['.bibleignore', bibleignoreTemplate()],
    ['src/main.ts', entryPointTemplate(name)],
    ['src/verseUtils.ts', verseUtilsTemplate()],
    ['src/panel.ts', panelTemplate(name)],
    ['src/bible-env.d.ts', bibleEnvTemplate()],
    ['ui/index.html', uiHtmlTemplate(name)],
    ['ui/styles.css', uiStylesTemplate()],
    ['test/main.test.ts', testTemplate(id)],
  ];

  for (const [filePath, content] of files) {
    const fullPath = path.join(targetDir, filePath);
    fs.writeFileSync(fullPath, content, 'utf-8');
    console.log(`  Created ${filePath}`);
  }

  console.log(`
Done! Next steps:

  cd ${id}
  npm install
  npm test           # Run the sample tests
  npm run build      # Typecheck, then bundle to dist/main.js
  npm run validate   # Check extension.json and the files it points at
  npm run package    # Build the installable .zip into build/

To try it in the app without packaging: Preferences > Extensions, turn on
Developer Mode, then "Load unpacked extension..." and pick this folder. The
host re-reads it whenever the build output changes, so \`npm run watch\` in one
terminal gives you reload-on-save.

Your extension runs in a sandboxed realm with no Node, no filesystem and no
network of its own — see "How extensions run" in README.md.
`);
}

main();
