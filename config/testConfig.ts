import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Centralized test configuration
 * All test data, timeouts, and URLs are managed here
 */

export interface TestAddress {
  title: 'Mr' | 'Mrs' | 'Ms' | 'M' | 'Mme' | 'Mlle';
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  postalCode: string;
  phone: string;
  country: string;
}

export interface TestPayment {
  cardNumber: string;
  cardHolder: string;
  expiryDate: string;
  cvv: string;
}

export interface TestConfig {
  timeouts: {
    test: number;
    element: number;
    navigation: number;
    api: number;
    long: number;
    medium: number;
    short: number;
  };
  testData: {
    email: string;
    address: TestAddress;
    payment: TestPayment;
  };
  urls: {
    base: string;
    testProduct: string;
  };
  retries: {
    default: number;
    flaky: number;
  };
  auth: {
    username: string;
    password: string;
  };
}

/**
 * Validate that required environment variables are present
 */
function validateRequiredEnvVars(): void {
  const required = ['HTTP_AUTH_USER', 'HTTP_AUTH_PASSWORD', 'BASE_URL', 'TEST_EMAIL'];

  const missing = required.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please create a .env file based on .env.example'
    );
  }
}

/**
 * Get environment variable with fallback
 */
function getEnvVar(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Get environment variable as number with fallback
 */
function getEnvNumber(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? parseInt(value, 10) : fallback;
}

// Validate environment on module load
validateRequiredEnvVars();

/**
 * Main test configuration object
 * Use this throughout your tests for consistent configuration
 */
export const TEST_CONFIG: TestConfig = {
  timeouts: {
    test: getEnvNumber('TIMEOUT_TEST', 120_000),
    element: getEnvNumber('TIMEOUT_ELEMENT', 10_000),
    navigation: getEnvNumber('TIMEOUT_PAGE_LOAD', 30_000),
    api: 15_000,
    long: 120_000,
    medium: 60_000,
    short: 30_000,
  },

  testData: {
    email: process.env.TEST_EMAIL!,
    address: {
      title: 'Mr',
      firstName: getEnvVar('TEST_USER_FIRSTNAME', 'Test'),
      lastName: getEnvVar('TEST_USER_LASTNAME', 'User'),
      street: getEnvVar('TEST_ADDRESS_STREET', '123 Test Street'),
      city: getEnvVar('TEST_ADDRESS_CITY', 'Paris'),
      postalCode: getEnvVar('TEST_ADDRESS_POSTAL_CODE', '75001'),
      phone: getEnvVar('TEST_USER_PHONE', '0612345678'),
      country: getEnvVar('TEST_ADDRESS_COUNTRY', 'FR'),
    },
    payment: {
      cardNumber: getEnvVar('TEST_CARD_NUMBER', '4111111111111111'),
      cardHolder: getEnvVar('TEST_CARD_HOLDER', 'Test User'),
      expiryDate: getEnvVar('TEST_CARD_EXPIRY', '03/30'),
      cvv: getEnvVar('TEST_CARD_CVV', '737'),
    },
  },

  urls: {
    base: process.env.BASE_URL!,
    testProduct: getEnvVar(
      'TEST_PRODUCT_URL',
      '/fr-fr/celine-boutique-femme/mini-sacs/trio-flap/trio-flap-agneau-lisse-10P862O86.28PO.html'
    ),
  },

  retries: {
    default: process.env.CI ? 2 : 0,
    flaky: 3,
  },

  auth: {
    username: process.env.HTTP_AUTH_USER!,
    password: process.env.HTTP_AUTH_PASSWORD!,
  },
} as const;

/**
 * Helper function to get full URL
 */
export function getFullUrl(path: string): string {
  const base = TEST_CONFIG.urls.base;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * Helper to check if running in CI environment
 */
export function isCI(): boolean {
  return !!process.env.CI;
}

/**
 * Helper to check if headless mode
 */
export function isHeadless(): boolean {
  return process.env.HEADLESS === 'true';
}

/**
 * Centralized timeouts - single source of truth
 * Derives base values from TEST_CONFIG, adds granular timing constants.
 * Usage: import { TIMEOUTS } from '../config/testConfig';
 */
export const TIMEOUTS = {
  // --- Core timeouts (from TEST_CONFIG) ---
  /** Default element visibility timeout (10s) */
  element: TEST_CONFIG.timeouts.element,
  /** Page navigation timeout (30s) */
  navigation: TEST_CONFIG.timeouts.navigation,
  /** Network/API timeout (15s) */
  network: TEST_CONFIG.timeouts.api,
  /** Long timeout for slow operations (120s) */
  long: TEST_CONFIG.timeouts.long,

  // --- Interaction timeouts (tuned for parallel stability) ---
  /** Short timeout for quick checks (5s) */
  short: 5_000,
  /** Medium timeout (10s) */
  medium: 10_000,
  /** Click timeout (5s) */
  click: 5_000,
  /** Animation/transition timeout (200ms) - reduced for speed, still allows most JS */
  animation: 200,
  /** Iframe loading timeout (2s) */
  iframe: 2_000,

  // --- Form timing constants (workarounds for browser input races) ---
  /** Delay after focus before filling a field (50ms) */
  focusDelay: 50,
  /** Delay after filling a field to ensure browser processes input (50ms) */
  inputDelay: 50,
  /** Delay after selecting an option (200ms) */
  selectDelay: 200,
  /** Delay for page section transitions (300ms) - reduced */
  sectionTransition: 300,
  /** Delay for Adyen component loading (1s) */
  adyenLoad: 1_000,
  /** Delay after form submission (1s) */
  formSubmit: 1_000,
} as const;
