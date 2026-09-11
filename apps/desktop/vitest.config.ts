import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Force ONE copy of React. This app pins react/react-dom 18.3.1, but its
    // React libraries (zustand, @dnd-kit, @tiptap/react, dockview-react,
    // react-resizable-panels) resolve their peer against the workspace root,
    // where npm hoists a 19.x copy that nothing declares. Without this, a hook
    // called inside one of those libraries runs on React 19's dispatcher while
    // the tree renders under react-dom 18, and every such test dies with
    // "Cannot read properties of null (reading 'useCallback')".
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src/ui'),
      '@bible/core': path.resolve(__dirname, '../../packages/core/src'),
      '@bible/extension-testing': path.resolve(__dirname, '../../packages/extension-testing/src'),
    },
  },
  test: {
    // Enable global test APIs (describe, it, expect, etc.)
    globals: true,

    // Test environment - use jsdom for DOM-based tests
    environment: 'jsdom',

    // Setup file for React Testing Library, DOM matchers, and global mocks
    setupFiles: ['./vitest.setup.ts'],

    // Vitest replaces CSS modules with empty stubs by default, which is right
    // for the hundreds of component tests that import a stylesheet only so the
    // component can render. It is wrong for exactly one file: `themes.css` is
    // imported as TEXT (`?raw`) by `electron/extensions/hostThemeCss.ts`, which
    // parses it to build the design-token sheet served to extension panels over
    // `ext-ui://host/theme.css`. Stubbed, that import yields an empty string,
    // the parser finds no rules, and every token assertion fails against an
    // empty `:root {}` block - a failure that looks like a parser bug and is
    // not one.
    //
    // Scoped by regex rather than turned on globally so nothing else starts
    // paying for PostCSS/Tailwind processing in unit tests.
    css: { include: [/themes\.css/] },

    // Test file patterns
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'electron/**/*.{test,spec}.{js,ts}',
      'extension-runtime/**/*.{test,spec}.{js,ts}',
    ],
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
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },

    // Reporter configuration
    reporters: ['verbose'],

    // Timeout for tests
    testTimeout: 10000,

    // Watch mode options
    watch: false,
  },
});
