import importPlugin from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default [
  tseslint.configs.base,
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [
          // Server cannot import client-only code
          { target: './server/**/*', from: './src/components/**/*', message: 'Server code must not import client components.' },
          { target: './server/**/*', from: './src/stores/**/*',     message: 'Server code must not import client stores.' },
          { target: './server/**/*', from: './src/hooks/**/*',      message: 'Server code must not import client hooks.' },
          { target: './server/**/*', from: './src/panes/**/*',      message: 'Server code must not import client panes.' },
          { target: './server/**/*', from: './src/providers/**/*',  message: 'Server code must not import client providers.' },
          { target: './server/**/*', from: './src/styles/**/*',     message: 'Server code must not import client styles.' },
          { target: './server/**/*', from: './src/events/**/*',     message: 'Server code must not import client events.' },
          // Client cannot import server code
          { target: './src/**/*', from: './server/**/*', message: 'Client code must not import server modules.' },
        ],
      }],
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'e2e/**'] },
];
