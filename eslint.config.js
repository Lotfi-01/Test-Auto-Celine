// Sprint 1 — ESLint tightened to prevent NEW silent failures.
// Sprint 10 — historical debt liquidated. The `HISTORICAL_SILENT_CATCH_FILES`
// override is reduced to the last 2 files that still carry a single
// tolerated pattern each; everything else runs under the strict rules.
//
// Policy:
//  - Silent-catch baseline is 0 (`scripts/silent-catch.baseline.json`) —
//    the campaign that ran Sprints 2-9 liquidated all 82 historical
//    occurrences.
//  - `no-empty` is strict (empty catch blocks are forbidden) except on
//    the 2 files listed in `HISTORICAL_SILENT_CATCH_FILES` where a single
//    residual pattern remains (out of scope for Sprint 10, tracked in
//    `docs/DEBT.md § Actions Sprint 11`).
//  - A custom `no-restricted-syntax` rule flags NEW silent `.catch(() => {})`
//    call sites so any PR introducing one is rejected — enforced with
//    `error` on every file outside the 2-file override.
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
 * Files still carrying a single tolerated pattern each after the
 * Sprint 2-9 silent-catch campaign:
 *
 *   - `pages/checkout/CheckoutShippingPage.ts`  — 1 residual empty catch
 *     block `} catch {}` inside `selectFirstShippingMethod` (fail-open
 *     fallback around `safeClickWithLabelFallback`; out of scope for
 *     Sprint 10, tracked in `docs/DEBT.md § Actions Sprint 11`).
 *   - `tests/celine-purchase.spec.ts` — 1 residual comment-only
 *     `.catch` handler (BlockStatement whose body is one comment) on the
 *     JP/NL shipping-method race (`Promise.race([...]).catch`). The AST
 *     rule fires on comment-only bodies even when the regex baseline
 *     does not; tracked as Sprint 11 debt.
 *
 * These 2 files run the 4 override rules below at their permissive
 * setting. Every OTHER file runs the strict setting. Do NOT extend this
 * list — Sprint 10 shrunk it from 15 files to 2. Removing a file from
 * this list requires proving via `npm run lint` that the file passes
 * strict `no-empty` + `no-restricted-syntax` + `preserve-caught-error` +
 * `no-useless-assignment` rules first.
 */
const HISTORICAL_SILENT_CATCH_FILES = ['pages/checkout/CheckoutShippingPage.ts', 'tests/celine-purchase.spec.ts'];

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

  // Sprint 10 residual override — 2 files retain 1 tolerated pattern each
  // (see the JSDoc on `HISTORICAL_SILENT_CATCH_FILES` above). Every other
  // file runs the strict rules. Sprint 11 target: convert these last 2
  // sites and REMOVE this override entirely.
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
