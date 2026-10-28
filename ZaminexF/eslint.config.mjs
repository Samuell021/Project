import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

// Vite transpiles TypeScript without checking names. Catch runtime ReferenceErrors
// (including incomplete renames) before publishing the Django frontend assets.
export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, lib: ['es2022', 'dom'] },
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: { 'no-undef': ['error', { typeof: true }] },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: globals.node },
  },
];
