/**
 * Test data configuration by region
 * Provides region-specific test data (FR, US, JP, AU, TH, NL)
 *
 * SECURITY POLICY (Sprint 1 — do not weaken):
 *  - This file MUST NOT contain any real credential, password, personal email,
 *    real PAN, CVV or shared sandbox account. All sensitive values come from
 *    environment variables via `.env` (see `.env.example`).
 *  - When a required variable is missing at test time, `requireEnv(name)`
 *    throws with a clear message so the failure surfaces immediately in the
 *    test that needs it — NOT at Playwright config load time (that would
 *    break unit tests / lint / typecheck).
 *  - Card numbers accepted here are ONLY the sandbox card numbers documented
 *    by Adyen and Cybersource. Never use a real card.
 */

/**
 * Read an env var; throw with a clear message if it's missing or empty.
 * Use this at *test runtime* (inside a step / fixture), not at module load.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Set it in your .env file (see .env.example) or in your CI secret store.`
    );
  }
  return value;
}

/**
 * Read an env var with a fallback. NEVER pass a real credential as fallback —
 * only use for non-sensitive defaults (delivery mode, product URL, etc.).
 */
function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

/**
 * Lazy accessors for shared sandbox credentials. Return null when the env
 * var is not set so the caller can decide (skip the test, throw a clear
 * error, etc.). Never fall back to a hardcoded value.
 */
export const PAYPAL_CREDENTIALS = {
  get email(): string {
    return requireEnv('PAYPAL_EMAIL');
  },
  get password(): string {
    return requireEnv('PAYPAL_PASSWORD');
  },
};

export const AFTERPAY_AU_CREDENTIALS = {
  get email(): string {
    return requireEnv('AFTERPAY_AU_EMAIL');
  },
  get password(): string {
    return requireEnv('AFTERPAY_AU_PASSWORD');
  },
};

export interface RegionalTestData {
  email: string;
  /**
   * Password for registered customer login in checkout (email + password flow).
   * Sourced from TEST_PASSWORD_<REGION>. When absent, tests that need a
   * registered login will fail with a clear "missing env var" error.
   */
  password?: string;
  address: {
    title: 'Mr' | 'Mrs' | 'Ms' | 'M' | 'Mme' | 'Mlle';
    firstName: string;
    lastName: string;
    firstNameKatakana?: string;
    lastNameKatakana?: string;
    street: string;
    city: string;
    state?: string;
    postalCode: string;
    phone: string;
    phonePrefix?: string;
    country: string;
  };
  payment: {
    cardNumber: string;
    cardHolder: string;
    expiryDate: string;
    cvv: string;
  };
  productUrl: string | string[];
  /** 'home' (standard delivery) or 'pickup' (Click & Collect). Default: 'home'. */
  deliveryMode?: 'home' | 'pickup';
}

/**
 * Default product URLs per region.
 * These are PUBLIC PDP paths on the Celine site, not credentials.
 * Priority is: TEST_PRODUCT_URL_<REGION> env var > this default.
 */
const DEFAULT_PRODUCTS: Record<string, string | string[]> = {
  FR: '/fr-fr/celine-boutique-femme/mini-sacs/trio-flap/trio-flap-agneau-lisse-10P862O86.28PO.html',
  US: '/en-us/celine-haute-parfumerie/fragrances/parade-eau-de-parfum-100ml-6PC1H0805.37TT.html',
  JP: '/en-jp/celine-women/handbags/triomphe/teen-triomphe-bag-in-shiny-calfskin-188423BF4.38NO.html',
  AU: '/en-au/women/shoes/sneakers/block-sneakers-with-wedge-outsole-in-calfskin-346163338C.01OP.html',
  TH: '/en-th/women/accessories/hats-and-gloves/triomphe-beanie-in-seamless-cashmere-2AA32384D.38NO.html',
  NL: '/en-nl/women/handbags/triomphe-canvas/teen-triomphe-bag-in-triomphe-canvas-and-calfskin-188882BZ4.04LU.html',
};

type Region = 'FR' | 'US' | 'JP' | 'AU' | 'TH' | 'NL';

function getProductUrl(region: Region): string | string[] {
  const envVarName = `TEST_PRODUCT_URL_${region}`;
  const raw = process.env[envVarName];

  if (raw) {
    if (raw.includes(',')) {
      return raw
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
    }
    return raw;
  }

  const defaultUrl = DEFAULT_PRODUCTS[region];
  if (!defaultUrl) {
    throw new Error(`No default product URL for region ${region}. Please set ${envVarName} in your .env.`);
  }
  return defaultUrl;
}

function getDeliveryMode(region: Region): 'home' | 'pickup' {
  const raw = (process.env[`TEST_DELIVERY_MODE_${region}`] || '').toLowerCase().trim();
  return raw === 'pickup' || raw === 'click-collect' || raw === 'cc' ? 'pickup' : 'home';
}

/**
 * Read the test card configuration for a region from env vars.
 * All fields are required — if missing, throws a clear error at test runtime.
 * The CI/dev must provide the Adyen/Cybersource-documented sandbox card values.
 */
function getRegionCard(region: Region): {
  cardNumber: string;
  expiryDate: string;
  cvv: string;
  cardHolder: string;
} {
  return {
    cardNumber: requireEnv(`TEST_CARD_NUMBER_${region}`),
    expiryDate: requireEnv(`TEST_CARD_EXPIRY_${region}`),
    cvv: requireEnv(`TEST_CARD_CVV_${region}`),
    cardHolder: requireEnv(`TEST_CARDHOLDER_${region}`),
  };
}

/**
 * AU allows a scheme switch (Visa default, EFTPos for 3DS testing).
 * When TEST_CARD_SCHEME_AU=eftpos, callers still supply TEST_CARD_NUMBER_AU
 * etc.; the scheme flag is here for POM branching only.
 */
export function getAuCardScheme(): 'visa' | 'eftpos' {
  const scheme = (process.env.TEST_CARD_SCHEME_AU || 'visa').toLowerCase().trim();
  return scheme === 'eftpos' ? 'eftpos' : 'visa';
}

/**
 * Region test data — all sensitive values loaded lazily via getters so that
 * `import { TEST_DATA_FR } from '...'` at module load does NOT require the env
 * to be complete (lint / typecheck / unit tests must pass without secrets).
 * The env vars are only read when a getter is accessed at runtime.
 */
function makeRegionalTestData(region: Region, address: RegionalTestData['address']): RegionalTestData {
  return {
    get email(): string {
      return requireEnv(`TEST_EMAIL_${region}`);
    },
    get password(): string {
      return requireEnv(`TEST_PASSWORD_${region}`);
    },
    address,
    get payment() {
      return getRegionCard(region);
    },
    get productUrl() {
      return getProductUrl(region);
    },
    get deliveryMode() {
      return getDeliveryMode(region);
    },
  } as RegionalTestData;
}

/**
 * Regional addresses — non-sensitive test fixtures (public place names,
 * dummy names). Real personal identities MUST NOT be added here.
 */

export const TEST_DATA_FR: RegionalTestData = makeRegionalTestData('FR', {
  title: 'M',
  firstName: envOr('TEST_FIRSTNAME_FR', 'Test'),
  lastName: envOr('TEST_LASTNAME_FR', 'User'),
  street: envOr('TEST_STREET_FR', '123 Avenue des Champs-Élysées'),
  city: envOr('TEST_CITY_FR', 'Paris'),
  postalCode: envOr('TEST_POSTAL_FR', '75008'),
  phone: envOr('TEST_PHONE_FR', '0612345678'),
  country: 'FR',
});

export const TEST_DATA_US: RegionalTestData = makeRegionalTestData('US', {
  title: 'Mr',
  firstName: envOr('TEST_FIRSTNAME_US', 'Test'),
  lastName: envOr('TEST_LASTNAME_US', 'User'),
  street: envOr('TEST_STREET_US', '123 Fifth Avenue'),
  city: envOr('TEST_CITY_US', 'New York'),
  state: envOr('TEST_STATE_US', 'NY'),
  postalCode: envOr('TEST_POSTAL_US', '10001'),
  phone: envOr('TEST_PHONE_US', '6464233453'),
  country: 'US',
});

export const TEST_DATA_JP: RegionalTestData = makeRegionalTestData('JP', {
  title: 'Mr',
  firstName: envOr('TEST_FIRSTNAME_JP', 'Test'),
  lastName: envOr('TEST_LASTNAME_JP', 'Tanaka'),
  firstNameKatakana: envOr('TEST_FIRSTNAME_KANA_JP', 'テスト'),
  lastNameKatakana: envOr('TEST_LASTNAME_KANA_JP', 'タナカ'),
  street: envOr('TEST_STREET_JP', '1-2-3 Shibuya'),
  city: envOr('TEST_CITY_JP', 'Tokyo'),
  postalCode: envOr('TEST_POSTAL_JP', '150-0002'),
  phone: envOr('TEST_PHONE_JP', '09012345678'),
  country: 'JP',
});

export const TEST_DATA_AU: RegionalTestData = makeRegionalTestData('AU', {
  title: (process.env.TEST_TITLE_AU as 'Ms' | 'Mrs' | 'Mr') || 'Ms',
  firstName: envOr('TEST_FIRSTNAME_AU', 'Test'),
  lastName: envOr('TEST_LASTNAME_AU', 'User'),
  street: envOr('TEST_STREET_AU', '1 Macquarie Street'),
  city: envOr('TEST_CITY_AU', 'Barangaroo'),
  state: envOr('TEST_STATE_AU', 'NSW'),
  postalCode: envOr('TEST_POSTAL_AU', '2000'),
  phone: envOr('TEST_PHONE_AU', '412345678'),
  phonePrefix: '+61',
  country: 'AU',
});

export const TEST_DATA_TH: RegionalTestData = makeRegionalTestData('TH', {
  title: (process.env.TEST_TITLE_TH as 'Ms' | 'Mrs' | 'Mr') || 'Ms',
  firstName: envOr('TEST_FIRSTNAME_TH', 'Test'),
  lastName: envOr('TEST_LASTNAME_TH', 'User'),
  street: envOr('TEST_STREET_TH', '999/9 Rama I Road'),
  city: envOr('TEST_CITY_TH', 'Pathum Wan'),
  state: envOr('TEST_STATE_TH', 'BANGKOK'),
  postalCode: envOr('TEST_POSTAL_TH', '10330'),
  phone: envOr('TEST_PHONE_TH', '821234567'),
  phonePrefix: '+66',
  country: 'TH',
});

export const TEST_DATA_NL: RegionalTestData = makeRegionalTestData('NL', {
  title: 'Mr',
  firstName: envOr('TEST_FIRSTNAME_NL', 'Test'),
  lastName: envOr('TEST_LASTNAME_NL', 'User'),
  street: envOr('TEST_STREET_NL', '123 Damrak'),
  city: envOr('TEST_CITY_NL', 'Amsterdam'),
  postalCode: envOr('TEST_POSTAL_NL', '1012'),
  phone: envOr('TEST_PHONE_NL', '0612345678'),
  country: 'NL',
});

export function getTestDataForRegion(region: string): RegionalTestData {
  const regionLower = region.toLowerCase();
  if (regionLower.includes('au')) return TEST_DATA_AU;
  if (regionLower.includes('th')) return TEST_DATA_TH;
  if (regionLower.includes('fr')) return TEST_DATA_FR;
  if (regionLower.includes('us')) return TEST_DATA_US;
  if (regionLower.includes('jp')) return TEST_DATA_JP;
  if (regionLower.includes('nl')) return TEST_DATA_NL;
  return TEST_DATA_FR;
}

export function getTestDataForProject(projectName: string): RegionalTestData {
  return getTestDataForRegion(projectName);
}
