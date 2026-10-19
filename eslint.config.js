const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores([
    '**/.expo/**',
    '**/android/**',
    '**/ios/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    'archive/**',
  ]),
  expoConfig,
  prettierConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ThrowStatement > Literal:not([value=null])',
          message: 'Throw Error objects, never strings or primitive values.',
        },
      ],
    },
  },
  {
    files: ['*.config.{js,mjs,ts}', 'apps/mobile/app.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    settings: {
      react: {
        version: '19.2',
      },
    },
  },
]);
