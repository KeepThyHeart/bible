import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const shared = {
  environment: 'jsdom' as const,
  globals: true, // RTL and PTL auto-cleanup hooks need a global afterEach
  setupFiles: ['./vitest.setup.ts'],
  include: ['src/**/*.test.{ts,tsx}', 'css/**/*.test.ts'],
};

/**
 * One suite, two runtimes: every test runs once against real React 18 and once
 * with `react` aliased to preact/compat (how the web app consumes this package).
 * Tests import `@testing-library/react`; the preact project swaps it for
 * `@testing-library/preact`.
 */
export default defineConfig({
  resolve: {
    alias: { '@bible/core/browser': resolve(__dirname, '../core/src/browser.ts') },
  },
  test: {
    projects: [
      {
        extends: true,
        resolve: { dedupe: ['react', 'react-dom'] },
        test: { ...shared, name: 'react', env: { KTH_UI_RUNTIME: 'react' } },
      },
      {
        extends: true,
        resolve: {
          // Array form: exact regexes, most specific first.
          alias: [
            { find: /^react-dom\/test-utils$/, replacement: 'preact/test-utils' },
            { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
            { find: /^react-dom$/, replacement: 'preact/compat' },
            { find: /^react\/jsx-runtime$/, replacement: 'preact/compat/jsx-runtime' },
            { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/compat/jsx-dev-runtime' },
            { find: /^react$/, replacement: 'preact/compat' },
            { find: /^@testing-library\/react$/, replacement: '@testing-library/preact' },
          ],
        },
        test: { ...shared, name: 'preact', env: { KTH_UI_RUNTIME: 'preact' } },
      },
    ],
  },
});
