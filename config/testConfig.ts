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
    /** Global per-test timeout (ms) */
    test: number;
    /** Default element visibility / interaction timeout (ms) */
    element: number;
    /** Page navigation timeout (ms) */
    navigation: number;
    /** Network / API response timeout (ms) */
    api: number;
    // NOTE: `short`, `medium`, `long` were removed here to eliminate the
    // name collision with `TIMEOUTS.short/medium/long` (which had DIFFERENT
    // values). Use `TIMEOUTS.*` below for granular interaction timings.
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
 * Assert that E2E-required environment variables are present.
 *
 * IMPORTANT: this is NOT called at module load anymore (Sprint 1). Unit tests,
 * lint and typecheck must succeed with no `.env` at all. Call this explicitly
 * from a Playwright fixture / global-setup / test.beforeAll when the current
 * run actually needs to hit the sandbox.
 *
 * The check is idempotent within a single Node process — after the first
 * successful assertion, subsequent calls are no-ops. This lets us guard every
 * Celine fixture without adding latency or duplicate logs.
 */
let e2eEnvAsserted = false;

export function assertE2EEnv(): void {
  if (e2eEnvAsserted) return;

  const required = ['HTTP_AUTH_USER', 'HTTP_AUTH_PASSWORD', 'BASE_URL'];
  const missing = required.filter((varName) => {
    const value = process.env[varName];
    return !value || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required E2E environment variable(s): ${missing.join(', ')}.`,
        '',
        'What to do:',
        '  1. Locally: copy .env.example to .env and fill the values from your',
        '     secret store (Vault, 1Password, LVMH KMS).',
        '  2. In CI:   provision these secrets in the GitHub Actions',
        '     "e2e" protected environment. The `quality-gate` job runs',
        '     without any secret; only the `e2e` job requires them.',
        '',
        'This assertion is invoked from every Celine test fixture at runtime.',
        'Unit tests / lint / typecheck do NOT trigger it.',
      ].join('\n')
    );
  }

  e2eEnvAsserted = true;
}

/**
 * Test-only helper — reset the memoized flag so a unit test can exercise
 * both the "missing env" and "populated env" branches of `assertE2EEnv`.
 * Never call this from production code.
 */
export function __resetE2EEnvAssertionForTests(): void {
  e2eEnvAsserted = false;
}

/**
 * Read an env var with a NON-SENSITIVE fallback.
 *
 * SECURITY: never pass a secret (password, PAN, email, token) as a fallback.
 * For sensitive values, use `requireEnv()` from `config/testData.ts` instead,
 * which throws when the value is missing.
 */
export function getEnvVar(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

/**
 * Get environment variable as number with fallback
 */
function getEnvNumber(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? parseInt(value, 10) : fallback;
}

/**
 * Main test configuration object.
 *
 * IMPORTANT: this object is built from getters so that reading it does NOT
 * require .env to be fully populated. `TEST_CONFIG.auth.username` throws only
 * when actually accessed. This keeps lint / typecheck / unit tests working
 * without any secret.
 */
export const TEST_CONFIG: TestConfig = {
  timeouts: {
    test: getEnvNumber('TIMEOUT_TEST', 120_000),
    element: getEnvNumber('TIMEOUT_ELEMENT', 10_000),
    navigation: getEnvNumber('TIMEOUT_PAGE_LOAD', 30_000),
    api: 15_000,
  },

  testData: {
    // Legacy generic email — kept for backward compat; region-specific data is
    // in `config/testData.ts` and should be preferred in new code.
    get email(): string {
      return process.env.TEST_EMAIL || process.env.TEST_EMAIL_FR || '';
    },
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
    // No sandbox card is hardcoded here anymore (Sprint 1 security). Use the
    // region-specific data from `config/testData.ts` (TEST_CARD_*_<REGION>).
    payment: {
      get cardNumber(): string {
        return process.env.TEST_CARD_NUMBER || '';
      },
      get cardHolder(): string {
        return process.env.TEST_CARD_HOLDER || '';
      },
      get expiryDate(): string {
        return process.env.TEST_CARD_EXPIRY || '';
      },
      get cvv(): string {
        return process.env.TEST_CARD_CVV || '';
      },
    },
  },

  urls: {
    get base(): string {
      return process.env.BASE_URL || '';
    },
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
    get username(): string {
      return process.env.HTTP_AUTH_USER || '';
    },
    get password(): string {
      return process.env.HTTP_AUTH_PASSWORD || '';
    },
  },
};

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
 * Centralized timeouts — SINGLE source of truth for granular interaction
 * timings. `TEST_CONFIG.timeouts` is the config layer (env-overridable core
 * timeouts: test / element / navigation / api). `TIMEOUTS` below is what page
 * objects and specs should import for click / animation / iframe / form
 * timings. Do NOT reintroduce `short/medium/long` fields on
 * `TEST_CONFIG.timeouts` — the collision that used to exist here was the
 * root cause of the FR-B1 finding in CODE_REVIEW.md.
 *
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
  long: 120_000,

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
