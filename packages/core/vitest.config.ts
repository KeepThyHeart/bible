import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Enable global test APIs (describe, it, expect, etc.)
    globals: true,

    // Test environment
    environment: 'node',

    // v0.2 modules ship no FTS5 table: build the real test modules' sidecar
    // keyword indexes once, then configure every worker to search them.
    globalSetup: ['src/__tests__/setup/keywordIndexGlobalSetup.ts'],
    setupFiles: ['src/__tests__/setup/keywordIndexSetup.ts'],

    // Test file patterns
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/dist/**',
        '**/node_modules/**',
        '**/example*.ts',
        '**/*.config.ts',
        '**/__tests__/**',
      ],
      // Report uncovered source files too, not only the ones a test loaded.
      include: ['src/**/*.ts'],
    },

    // Reporter configuration
    reporters: ['verbose'],

    // Timeout for tests (longer for database tests)
    testTimeout: 15000,

    // Watch mode options
    watch: false,

    // Hook timeout (for beforeAll/afterAll with database setup)
    hookTimeout: 30000,
  },
});
