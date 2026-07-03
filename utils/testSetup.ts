import { test, TestInfo, FullProject } from '@playwright/test';
import { TEST_CONFIG } from '../config/testConfig';

/**
 * Test Setup Utilities
 * Provides reusable functions for test configuration and validation
 */

/**
 * HTTP credentials configuration type
 */
export interface HttpCredentialsConfig {
  httpCredentials: {
    username: string;
    password: string;
  };
}

/**
 * Test metadata structure
 */
export interface TestMetadata {
  testName: string;
  project: string;
  file: string;
  browser: string;
  startTime: number;
}

/**
 * Setup HTTP authentication for tests
 * @returns HTTP credentials configuration object
 */
export function setupHttpAuth(): HttpCredentialsConfig {
  return {
    httpCredentials: {
      username: TEST_CONFIG.auth.username,
      password: TEST_CONFIG.auth.password,
    },
  };
}

/**
 * Skip test if no data is available
 * Useful for tests that depend on existing data (orders, etc.)
 * @param data - Data to check (array or object)
 * @param message - Message to display when skipping
 * @returns true if test was skipped, false otherwise
 */
export function skipIfNoData<T>(data: T | T[] | null | undefined, message: string): boolean {
  if (!data || (Array.isArray(data) && data.length === 0)) {
    console.log(`⚠️  ${message}`);
    test.skip();
    return true;
  }
  return false;
}

/**
 * Skip test if environment variable is not set
 * @param envVar - Environment variable name to check
 * @param message - Optional custom message
 * @returns true if test was skipped, false otherwise
 */
export function skipIfEnvNotSet(envVar: string, message?: string): boolean {
  if (!process.env[envVar]) {
    const defaultMessage = `${envVar} not configured in .env`;
    console.log(`⚠️  ${message || defaultMessage}`);
    test.skip();
    return true;
  }
  return false;
}

/**
 * Get test metadata for logging and reporting
 * @param testInfo - Playwright TestInfo object
 * @returns Metadata object with browser, project, etc.
 */
export function getTestMetadata(testInfo: TestInfo): TestMetadata {
  const project = testInfo.project as FullProject;
  return {
    testName: testInfo.title,
    project: project.name,
    file: testInfo.file,
    browser: (project.use?.browserName as string) || 'chromium',
    startTime: Date.now(),
  };
}

/**
 * Calculate test duration in human-readable format
 * @param startTime - Start timestamp in milliseconds
 * @returns Duration string (e.g., "2m 30s")
 */
export function formatTestDuration(startTime: number): string {
  const durationMs = Date.now() - startTime;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Extract region code from project name
 * @param projectName - Playwright project name (e.g., 'celine-fr', 'celine-us')
 * @returns Region code (e.g., 'fr', 'us', 'jp')
 */
export function extractRegionFromProject(projectName: string): string {
  const match = projectName.match(/celine-(\w+)/i);
  return match ? match[1].toLowerCase() : 'fr';
}
