// Minimal ESLint flat config — guard-rail only, NOT a global cleanup pass.
// See README.md §"Scripts qualité" for rationale on disabled rules.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'dist/**',
      'build/**',
      '**/*.log',
      'package-lock.json',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.ts'] })),

  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'preserve-caught-error': 'off',
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
    },
  },

  {
    files: ['tests/**/*.{ts,js}'],
    rules: {
      'no-empty-pattern': 'off',
    },
  },
];
