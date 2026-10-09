import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// @bible/core is consumed as source in tests (the runtime build uses core's dist).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@bible\/core\/browser$/, replacement: resolve(__dirname, '../core/src/browser.ts') },
      { find: /^@bible\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
