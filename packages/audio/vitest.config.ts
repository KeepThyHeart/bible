import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// @bible/core is consumed as source, as @bible/memory and @bible/speech do.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@bible\/core\/browser$/, replacement: resolve(__dirname, '../core/src/browser.ts') },
      { find: /^@bible\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    // The player, caches and media session are browser code; happy-dom as in the web app.
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    execArgv: Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-experimental-webstorage'] : [],
    testTimeout: 60_000,
  },
});
