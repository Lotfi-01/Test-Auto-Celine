// Sprint 1 — ESLint tightened to prevent NEW silent failures.
//
// Policy:
//  - Historical debt (~180 silent .catch(()=>{}) / empty catch blocks) is NOT
//    rewritten in this sprint; see docs/DEBT.md for the backlog.
//  - `no-empty` is now strict (empty catch blocks are forbidden).
//  - A custom `no-restricted-syntax` rule flags NEW silent `.catch(() => {})`
//    call sites so any PR introducing one is rejected. Existing occurrences
//    are surfaced as warnings (see the override at the bottom of this file)
//    so builds stay green while the debt is tracked.
//  - Any tolerated silent catch MUST include an explicit
//    `// eslint-disable-next-line no-empty` (block) or
//    `// eslint-disable-next-line playwright-celine/no-silent-catch` (chain)
//    with a short justification comment.

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/**
 * Files where the historical silent-catch debt lives (from CODE_REVIEW.md
 * §F-R2). Downgraded to `warn` here to keep CI green while the Sprint 2
 * refactor is planned. Do NOT extend this list.
 */
const HISTORICAL_SILENT_CATCH_FILES = [
  'pages/BasePage.ts',
  'pages/CelineHomePage.ts',
  'pages/CelineProductPage.ts',
  'pages/checkout/CheckoutLoginPage.ts',
  'pages/checkout/CheckoutPaymentPage.ts',
  'pages/checkout/CheckoutShippingPage.ts',
  'utils/adyenHelper.ts',
  'utils/cybersourceHelper.ts',
  'utils/fileLock.ts',
  'utils/formHelper.ts',
  'utils/orderTracker.ts',
  'utils/pageHelpers.ts',
  'utils/selectorStrategy.ts',
  'utils/testResultTracker.ts',
  'tests/celine-purchase.spec.ts',
];

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

  // Historical debt override — DOWNGRADE silent-catch and adjacent rules to
  // warn for the files that already carry the debt (documented in
  // `docs/DEBT.md`). This keeps CI green while blocking regression in NEW
  // files. Do not extend this list without opening a matching debt ticket.
  {
    files: HISTORICAL_SILENT_CATCH_FILES,
    rules: {
      'no-restricted-syntax': ['warn', ...SILENT_CATCH_SYNTAX],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
    },
  },
];
