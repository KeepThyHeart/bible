import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/page/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { window: 'readonly', document: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
