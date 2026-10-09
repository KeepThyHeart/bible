import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// @bible/core and @bible/extension-testing are consumed as source, as the desktop app does.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@bible\/core\/recite$/, replacement: resolve(__dirname, '../core/src/recite/index.ts') },
      { find: /^@bible\/core\/speech$/, replacement: resolve(__dirname, '../core/src/speech/index.ts') },
      { find: /^@bible\/core\/browser$/, replacement: resolve(__dirname, '../core/src/browser.ts') },
      { find: /^@bible\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
      { find: /^@bible\/extension-testing$/, replacement: resolve(__dirname, '../extension-testing/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
