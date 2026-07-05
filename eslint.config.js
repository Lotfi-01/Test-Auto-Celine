// Sprint 1 — ESLint tightened to prevent NEW silent failures.
// Sprint 11 — historical override removed. Every file now runs under the
// strict silent-catch rules; there is no per-file downgrade left in this
// config.
//
// Policy:
//  - Silent-catch baseline is 0 (`scripts/silent-catch.baseline.json`) —
//    the campaign that ran Sprints 2-9 liquidated all 82 historical
//    occurrences. Sprint 11 converted the last two AST-only residuals
//    (`} catch {}` in `CheckoutShippingPage` and `.catch(() => { /* … */ })`
//    in `celine-purchase.spec.ts`) and removed the last override.
//  - `no-empty` is strict tree-wide (empty catch blocks are forbidden).
//  - A custom `no-restricted-syntax` rule flags NEW silent
//    `.catch(() => {})` (empty-body arrow) call sites so any PR
//    introducing one is rejected at `error` level.
//  - The regex-based baseline in `scripts/check-silent-catch-baseline.js`
//    is a second line of defense: `npm run lint` fails if ANY file's
//    count grows beyond its baseline. Baseline is 0 tree-wide.
//  - Any tolerated silent catch MUST include an explicit
//    `// eslint-disable-next-line no-empty` (block) or
//    `// eslint-disable-next-line no-restricted-syntax` (chain) with a
//    short justification comment.

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/**
 * `no-restricted-syntax` selector matching `.catch(() => {})` or
 * `.catch(async () => {})` with an EMPTY body. These are the "silent catch"
 * patterns we forbid in NEW code.
 */
const SILENT_CATCH_SYNTAX = [
  {
    selector:
      "CallExpression[callee.property.name='catch'][arguments.length=1][arguments.0.type='ArrowFunctionExpression'][arguments.0.body.type='BlockStatement'][arguments.0.body.body.length=0]",
    message:
      "Silent .catch(() => {}) is forbidden. Log at debug/warn level with the error, or let it propagate. If truly optional, add an explicit '// eslint-disable-next-line no-restricted-syntax' with a justification.",
  },
];

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      // STRICT (Sprint 1): empty catch blocks are no longer tolerated for NEW code.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-useless-escape': 'off',
      // Warn on rethrows without cause propagation; historical files ignored below.
      'preserve-caught-error': 'warn',
      // `no-useless-assignment` is noisy on defensive init patterns; keep as warn.
      'no-useless-assignment': 'warn',
      // Forbid NEW `.catch(() => {})` silent chains.
      'no-restricted-syntax': ['error', ...SILENT_CATCH_SYNTAX],
    },
  },

  {
    files: ['tests/**/*.{ts,js}'],
    rules: {
      'no-empty-pattern': 'off',
    },
  },
];
