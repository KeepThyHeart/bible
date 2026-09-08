/**
 * Minimal flat ESLint config that enforces the single-egress rule:
 * no code in `electron/**` may open its own network connection. Every egress
 * path must go through `electron/services/NetworkGateway.ts` - the ONE module
 * exempt from these rules.
 *
 * Core ESLint rules only (no @typescript-eslint rules). The TypeScript parser
 * is used when installed so `.ts` files parse; otherwise ESLint falls back to
 * its default parser. CI runs `npm run lint` in the desktop package.
 *
 * Bans in `electron/**` (except the gateway):
 *   - importing `http` / `https` / `node:http` / `node:https`
 *   - the global `fetch`
 *   - `net.request(...)` and importing `net` from `electron`
 */

// Use the TypeScript parser if it is available so `.ts` type syntax parses.
// It is not a hard dependency of this config - the deps wave that installs
// eslint is expected to provide a parser for CI.
let tsParser;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  tsParser = require('@typescript-eslint/parser');
} catch {
  tsParser = undefined;
}

// Register the @typescript-eslint plugin (when available) so that inline
// `// eslint-disable @typescript-eslint/...` directives that already exist in the
// electron sources resolve to a known rule. NO @typescript-eslint rules are
// enabled here - this config's sole job is the single-egress rule below.
// Registering the plugin only supplies rule *definitions*; it turns nothing on.
let tsPlugin;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  tsPlugin = require('@typescript-eslint/eslint-plugin');
} catch {
  tsPlugin = undefined;
}

const restrictedImportPaths = [
  { name: 'http', message: 'Use NetworkGateway (electron/services/NetworkGateway.ts) for egress.' },
  { name: 'https', message: 'Use NetworkGateway (electron/services/NetworkGateway.ts) for egress.' },
  { name: 'node:http', message: 'Use NetworkGateway (electron/services/NetworkGateway.ts) for egress.' },
  { name: 'node:https', message: 'Use NetworkGateway (electron/services/NetworkGateway.ts) for egress.' },
];

const gatewayOnlyRules = {
  'no-restricted-imports': ['error', { paths: restrictedImportPaths }],
  'no-restricted-globals': [
    'error',
    {
      name: 'fetch',
      message:
        'Global fetch is banned in electron/**. Use NetworkGateway (electron/services/NetworkGateway.ts).',
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'net',
      property: 'request',
      message:
        'Electron net.request is banned outside NetworkGateway. Route egress through electron/services/NetworkGateway.ts.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[object.name='net'][property.name='request']",
      message:
        'Electron net.request is banned outside NetworkGateway. Route egress through electron/services/NetworkGateway.ts.',
    },
    {
      selector: "ImportDeclaration[source.value='electron'] ImportSpecifier[imported.name='net']",
      message:
        "Importing `net` from electron is banned outside NetworkGateway. Route egress through electron/services/NetworkGateway.ts.",
    },
  ],
};

module.exports = [
  // Global ignores. This config exists ONLY to enforce the egress rule on
  // `electron/**/*.ts`; it must never lint build output, dependencies, tests,
  // the renderer/React sources, or config files (all of which carry inline
  // eslint-disable directives for rules this minimal config doesn't load).
  {
    ignores: [
      '**/node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      'e2e/**',
      'src/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },
  {
    // `extension-runtime/**` is in scope because the realm supervisor is an
    // ordinary Node process running alongside untrusted extension code. It has
    // no business opening a socket, and anything it did open would bypass the
    // gateway's allowlist and the offline switch entirely.
    files: ['electron/**/*.ts', 'extension-runtime/**/*.ts'],
    // The gateway is the single sanctioned egress module; tests mock the
    // network and legitimately reference these names.
    ignores: [
      'electron/services/NetworkGateway.ts',
      'electron/**/__tests__/**',
      'electron/**/*.test.ts',
      'extension-runtime/**/__tests__/**',
    ],
    // Register (but do not enable) the @typescript-eslint plugin so existing
    // inline `@typescript-eslint/*` disable directives resolve to known rules.
    ...(tsPlugin ? { plugins: { '@typescript-eslint': tsPlugin } } : {}),
    ...(tsParser ? { languageOptions: { parser: tsParser } } : {}),
    // This config only enforces the egress rule; the electron sources carry
    // inline disables for @typescript-eslint rules we intentionally leave off,
    // so don't report those as "unused" - it isn't this config's concern.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: gatewayOnlyRules,
  },
];
