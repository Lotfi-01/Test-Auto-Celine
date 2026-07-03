import { devices } from '@playwright/test';
import { TEST_CONFIG } from './testConfig';
import { TEST_DATA_FR, TEST_DATA_US, TEST_DATA_JP, TEST_DATA_AU, TEST_DATA_TH, TEST_DATA_NL, RegionalTestData } from './testData';

/**
 * Regional Configuration
 * Centralizes region-specific settings for Playwright projects
 */

export interface RegionConfig {
  code: string;
  name: string;
  baseURL: string;
  locale: string;
  timezone: string;
  testData: RegionalTestData;
}

/**
 * All region configurations
 * Single source of truth for regional settings
 */
export const REGIONS: Record<string, RegionConfig> = {
  FR: {
    code: 'fr',
    name: 'celine-fr',
    baseURL: process.env.BASE_URL!,
    locale: 'fr-FR',
    timezone: 'Europe/Paris',
    testData: TEST_DATA_FR,
  },
  US: {
    code: 'us',
    name: 'celine-us',
    baseURL: process.env.BASE_URL_US || process.env.BASE_URL!,
    locale: 'en-US',
    timezone: 'America/New_York',
    testData: TEST_DATA_US,
  },
  JP: {
    code: 'jp',
    name: 'celine-jp',
    baseURL: process.env.BASE_URL_JP || process.env.BASE_URL!,
    locale: 'ja-JP',
    timezone: 'Asia/Tokyo',
    testData: TEST_DATA_JP,
  },
  AU: {
    code: 'au',
    name: 'celine-au',
    baseURL: process.env.BASE_URL_AU || process.env.BASE_URL!,
    locale: 'en-AU',
    timezone: 'Australia/Sydney',
    testData: TEST_DATA_AU,
  },
  TH: {
    code: 'th',
    name: 'celine-th',
    baseURL: process.env.BASE_URL_TH || process.env.BASE_URL!,
    locale: 'en-TH',
    timezone: 'Asia/Bangkok',
    testData: TEST_DATA_TH,
  },
  NL: {
    code: 'nl',
    name: 'celine-nl',
    baseURL: process.env.BASE_URL_NL || process.env.BASE_URL!,
    locale: 'en-NL',
    timezone: 'Europe/Amsterdam',
    testData: TEST_DATA_NL,
  },
};

/**
 * Create Playwright project configurations for all regions
 * @returns Array of project configurations
 */
export function createRegionProjects() {
  return Object.entries(REGIONS).map(([code, config]) => ({
    name: config.name,
    testMatch: '**/celine-*.spec.ts',
    // TH sandbox sporadically expires the cart between Buy Now and checkout
    // (~30-60% rate). 1 retry absorbs that flake locally; keep CI's 2-retry budget.
    ...(code === 'TH' ? { retries: process.env.CI ? 2 : 1 } : {}),
    use: {
      ...devices['Desktop Chrome'],
      baseURL: config.baseURL,
      httpCredentials: TEST_CONFIG.auth,
      locale: config.locale,
      timezoneId: config.timezone,
      viewport: { width: 1920, height: 1080 },
      screenshot: 'off' as const,
      video: 'off' as const,
    },
  }));
}

/**
 * Get region configuration by project name
 * @param projectName - Playwright project name (e.g., 'celine-fr')
 * @returns Region configuration or undefined
 */
export function getRegionByProjectName(projectName: string): RegionConfig | undefined {
  return Object.values(REGIONS).find((region) => region.name === projectName);
}
