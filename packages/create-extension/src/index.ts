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
      $schema: 'https://bible-app.dev/schemas/extension-manifest.json',
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
            id: `ext.your-name.${id}.panel`,
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

function entryPointTemplate(id: string, name: string): string {
  return `// The BibleExtensionAPI type comes from @bible/core.
// import type { Extensions } from '@bible/core';
// type BibleExtensionAPI = Extensions.BibleExtensionAPI;

// Split your code across as many files as you like — esbuild inlines them all
// into the single dist/main.js the host loads. What you cannot do is import a
// Node built-in ('fs', 'path', 'crypto', …): the build is configured to fail
// on those, because the realm your extension runs in has none of them.
import { describeVerse } from './verseUtils';

/**
 * Called when the extension is activated.
 * Register commands, panels, and event listeners here.
 */
export async function activate(api: any): Promise<void> {
  // console.* is routed to the host and lands in your extension's log, which
  // you can read from the app's extension details view.
  console.log('${name} extension activated');

  // Register the panel type declared in extension.json
  await api.ui.registerPanelType('ext.your-name.${id}.panel', {
    title: '${name}',
    uiEntry: 'ui/index.html',
  });

  // Example: listen for verse changes
  await api.bible.onDidChangeActiveVerse.subscribe((event: any) => {
    if (event) {
      console.log('Active verse changed to:', describeVerse(event.verseId));
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
    <p>This panel is ready for your extension UI.</p>
  </div>

  <!--
    Use the @bible/extension-ui SDK to communicate with the host app:

    <script src="@bible/extension-ui/sdk.js"></script>
    <script>
      const sdk = window.BibleExtensionSDK;
      sdk.onMessage((msg) => {
        console.log('Message from extension host:', msg);
      });
      sdk.postMessage({ type: 'ready' });
    </script>
  -->
</body>
</html>
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
import { createMockApi, createTestHost, VERSE_JOHN_3_16 } from '@bible/extension-testing';
import { activate, deactivate } from '../src/main';

describe('${id} extension', () => {
  it('should activate without errors', async () => {
    const host = createTestHost({ activate, deactivate });
    await host.activate();
    expect(host.isActive()).toBe(true);
    await host.deactivate();
  });

  it('should register the panel type', async () => {
    const registerPanelSpy = vi.fn().mockResolvedValue({ dispose: vi.fn() });
    const api = createMockApi({
      ui: { registerPanelType: registerPanelSpy },
    });

    await activate(api);

    expect(registerPanelSpy).toHaveBeenCalledWith(
      'ext.your-name.${id}.panel',
      expect.objectContaining({
        uiEntry: 'ui/index.html',
      }),
    );
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

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('esbuild: watching for changes…');
} else {
  await build(options);
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

function packageJsonTemplate(id: string, name: string): string {
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
        typecheck: 'tsc --noEmit',
        watch: 'node esbuild.config.mjs --watch',
        clean: 'rm -rf dist',
        test: 'vitest run',
        'test:watch': 'vitest',
        smoke: 'bible-ext-smoke',
        package: 'npm run build && npm pack',
      },
      keywords: ['bible', 'extension'],
      license: 'MIT',
      devDependencies: {
        '@bible/core': '^1.0.0',
        '@bible/extension-testing': '^1.0.0',
        // @types/node is for the *build scripts* (esbuild.config.mjs), not for
        // your extension: tsconfig sets `types: []` so it never reaches src/.
        '@types/node': '^20.14.0',
        esbuild: '^0.25.0',
        typescript: '^5.5.0',
        vitest: '^2.0.0',
      },
      peerDependencies: {
        '@bible/core': '^1.0.0',
      },
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
`;
}

function gitignoreTemplate(): string {
  return `node_modules/
dist/
*.tgz
.DS_Store
`;
}

// ─── CLI logic ────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Usage: create-bible-extension <name> [options]

Arguments:
  name          Extension name (e.g. "greek-tools", "daily-reading")

Options:
  --help        Show this help message

Examples:
  create-bible-extension greek-tools
  create-bible-extension daily-reading
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

  const rawName = args[0];
  if (!rawName) {
    console.error('Error: Extension name is required.');
    printUsage();
    process.exit(1);
  }

  const id = toKebabCase(rawName);
  const name = toTitleCase(id);
  const targetDir = path.resolve(process.cwd(), id);

  if (fs.existsSync(targetDir)) {
    console.error(`Error: Directory "${id}" already exists.`);
    process.exit(1);
  }

  console.log(`Creating Bible extension "${name}" in ./${id}/\n`);

  // Create directory structure
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'ui'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'test'), { recursive: true });

  // Write files
  const files: Array<[string, string]> = [
    ['extension.json', manifestTemplate(id, name)],
    ['package.json', packageJsonTemplate(id, name)],
    ['tsconfig.json', tsconfigTemplate()],
    ['esbuild.config.mjs', esbuildConfigTemplate()],
    ['vitest.config.ts', vitestConfigTemplate()],
    ['README.md', readmeTemplate(id, name)],
    ['.gitignore', gitignoreTemplate()],
    ['src/main.ts', entryPointTemplate(id, name)],
    ['src/verseUtils.ts', verseUtilsTemplate()],
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
  npm test        # Run the sample tests
  npm run build   # Typecheck, then bundle to dist/main.js

Your extension runs in a sandboxed realm with no Node, no filesystem and no
network of its own — see "How extensions run" in README.md.
`);
}

main();
