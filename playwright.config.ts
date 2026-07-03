import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createRegionProjects } from './config/regionConfig';

// Load environment variables with explicit path
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Validate required environment variables
const requiredEnvVars = ['HTTP_AUTH_USER', 'HTTP_AUTH_PASSWORD', 'BASE_URL'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}\n` +
      'Please create a .env file based on .env.example'
  );
}

// Minimal startup log (avoid printing credentials in console output)
console.log('HTTP Auth is configured from environment variables.');

export default defineConfig({
  testDir: './tests',
  // Output to local temp (avoids OneDrive file locks that block the test runner)
  outputDir: path.join(process.env.TEMP || './test-results', 'playwright-results'),
  // Maximum time per test: 5 minutes (300s) - tests exceeding this will be killed
  timeout: 5 * 60 * 1000,
  expect: {
    timeout: 10000, // 10s for assertions
  },
  fullyParallel: true, // Enable parallel execution by default
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined, // Optimal for CI, use all CPUs locally
  reporter: 'html',

  // Global teardown for email reporting
  globalTeardown: './global-teardown.ts',

  projects: [
    // Unit tests - no browser needed, fast execution
    {
      name: 'unit',
      testMatch: '**/unit/*.spec.ts',
      timeout: 30_000, // 30s timeout for unit tests
    },
    {
      name: 'chromium',
      testIgnore: ['**/celine-*.spec.ts', '**/unit/*.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Regional projects (FR, US, JP) - generated from centralized config
    ...createRegionProjects(),
  ],
});
