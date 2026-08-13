const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores([
    '**/.expo/**',
    '**/android/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    'packages/ui/src/generated/**',
  ]),
  expoConfig,
  prettierConfig,
  {
    files: ['**/*.{ts,tsx}'],
    settings: {
      react: {
        version: '19.2',
      },
    },
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
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'M0 production code cannot register a network path.',
        },
        {
          name: 'WebSocket',
          message: 'M0 production code cannot register a network path.',
        },
        {
          name: 'XMLHttpRequest',
          message: 'M0 production code cannot register a network path.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Runtime code reads typed config ports, never process.env.',
        },
      ],
    },
  },
  {
    files: [
      '*.config.{js,mjs,ts}',
      'apps/mobile/app.config.ts',
      'tools/**/*.{js,mjs,ts}',
    ],
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
