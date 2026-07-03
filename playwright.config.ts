import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createRegionProjects } from './config/regionConfig';

// Load environment variables (best-effort — .env is optional; missing E2E env
// vars are validated later, only when a test actually needs them).
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Reporter policy (Sprint 1)
 * -----------------------------------------------------------------------------
 *  - Local: `html` only, do not auto-open (avoids blocking a headless run).
 *  - CI:    `blob` for shard-mergeable input + `html` for a browsable report +
 *           `github` annotations. `blob-report/`, `playwright-report/` and
 *           `test-results/` are the paths uploaded as artifacts.
 */
const reporter = process.env.CI
  ? ([['blob'], ['html', { open: 'never' }], ['github']] as const)
  : ([['html', { open: 'never' }]] as const);

/**
 * outputDir policy (Sprint 1)
 * -----------------------------------------------------------------------------
 * Priority:
 *   1. PW_OUTPUT_DIR env override (CI can pin this).
 *   2. `./test-results/` under the repo — the folder the CI workflow uploads.
 *   3. os.tmpdir() only when the repo path is not writable (rare — Windows
 *      OneDrive sync locks can trigger this; the escape hatch stays available
 *      via PW_OUTPUT_DIR=%TEMP%\playwright-results).
 */
const outputDir = process.env.PW_OUTPUT_DIR
  ? path.resolve(process.env.PW_OUTPUT_DIR)
  : path.resolve(__dirname, 'test-results');

export default defineConfig({
  testDir: './tests',
  outputDir,
  // Maximum time per test: 5 minutes (300s)
  timeout: 5 * 60 * 1000,
  expect: {
    timeout: 10_000, // 10s for assertions
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: reporter as unknown as Parameters<typeof defineConfig>[0]['reporter'],

  // Global teardown (email report — no-op if SEND_EMAIL_REPORT!=true)
  globalTeardown: './global-teardown.ts',

  projects: [
    // Unit tests — no browser, no E2E env required.
    {
      name: 'unit',
      testMatch: '**/unit/*.spec.ts',
      timeout: 30_000,
    },
    // Fallback chromium project — kept for ad-hoc scripts, does not run E2E specs.
    {
      name: 'chromium',
      testIgnore: ['**/celine-*.spec.ts', '**/unit/*.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Regional projects (FR, US, JP, AU, TH, NL) — need E2E env vars to run.
    // The `assertE2EEnv()` helper (`config/testConfig.ts`) is invoked from the
    // fixture / step that first touches the sandbox, so unit tests can still
    // load this config with no .env at all.
    ...createRegionProjects(),
  ],
});
