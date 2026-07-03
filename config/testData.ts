/**
 * Test data configuration by region
 * Provides region-specific test data (FR, US, etc.)
 *
 * SECURITY NOTE (Critical):
 * - All card numbers, passwords and external account credentials here are **SANDBOX only**.
 * - Prefer setting the corresponding TEST_* env vars in your .env file.
 * - The getEnvVar helper (with isSensitive=true) will emit a one-time warning when fallbacks are used.
 * - Never use production credentials.
 */

import { getEnvVar } from './testConfig';

/**
 * PayPal sandbox credentials — shared across all regions.
 * Override via TEST_PAYPAL_EMAIL / TEST_PAYPAL_PASSWORD.
 * IMPORTANT: These are PUBLIC sandbox values. Always prefer setting the env vars.
 */
export const PAYPAL_CREDENTIALS = {
  email: getEnvVar('TEST_PAYPAL_EMAIL', 'celine-marchand-sandbox@gmail.com', true),
  password: getEnvVar('TEST_PAYPAL_PASSWORD', 'Celine19!', true),
};

/**
 * Afterpay sandbox credentials — AU only.
 * Override via TEST_AFTERPAY_EMAIL_AU / TEST_AFTERPAY_PASSWORD_AU.
 */
export const AFTERPAY_AU_CREDENTIALS = {
  email: getEnvVar('TEST_AFTERPAY_EMAIL_AU', 'sebastien.dejoue+AU@celine.fr', true),
  password: getEnvVar('TEST_AFTERPAY_PASSWORD_AU', 'Testing!!Celine!', true),
};

export interface RegionalTestData {
  email: string;
  /**
   * Password for registered customer login in checkout (email + password flow).
   * SANDBOX ONLY. Never commit real customer passwords. Prefer env vars.
   */
  password?: string;
  address: {
    title: 'Mr' | 'Mrs' | 'Ms' | 'M' | 'Mme' | 'Mlle';
    firstName: string;
    lastName: string;
    firstNameKatakana?: string; // Optionnel - requis uniquement pour le Japon
    lastNameKatakana?: string; // Optionnel - requis uniquement pour le Japon
    street: string;
    city: string;
    state?: string; // Required for AU, US
    postalCode: string;
    phone: string;
    phonePrefix?: string; // Required for AU (e.g. "+61")
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
 * Default product URLs per region
 * Priority is always: TEST_PRODUCT_URL_<REGION> env var > this default.
 */
const DEFAULT_PRODUCTS: Record<string, string | string[]> = {
  FR: '/fr-fr/celine-boutique-femme/mini-sacs/trio-flap/trio-flap-agneau-lisse-10P862O86.28PO.html',
  US: '/en-us/celine-haute-parfumerie/fragrances/parade-eau-de-parfum-100ml-6PC1H0805.37TT.html',
  JP: '/en-jp/celine-women/handbags/triomphe/teen-triomphe-bag-in-shiny-calfskin-188423BF4.38NO.html',
  AU: '/en-au/women/shoes/sneakers/block-sneakers-with-wedge-outsole-in-calfskin-346163338C.01OP.html',
  TH: '/en-th/women/accessories/hats-and-gloves/triomphe-beanie-in-seamless-cashmere-2AA32384D.38NO.html',
  NL: '/en-nl/women/handbags/triomphe-canvas/teen-triomphe-bag-in-triomphe-canvas-and-calfskin-188882BZ4.04LU.html',
};

/**
 * Get product URL for a specific region
 * Priority: region-specific env var > region default
 * Note: Does NOT use TEST_PRODUCT_URL to avoid cross-region conflicts
 */
function getProductUrl(region: "FR" | "JP" | "AU" | "TH" | "NL" | "US"): string | string[] {
  const envVarName = `TEST_PRODUCT_URL_${region}`;
  const raw = process.env[envVarName];

  if (raw) {
    // Comma-separated list (no comma in Celine PDP URLs) → multiple products in one order
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
    throw new Error(
      `No default product URL for region ${region}. ` +
        `Please set the environment variable ${envVarName} ` +
        `(example: TEST_PRODUCT_URL_US=/en-us/.../your-product.html)`
    );
  }

  return defaultUrl;
}

/**
 * Read delivery mode for a region: TEST_DELIVERY_MODE_<REGION>=pickup → Click & Collect.
 * Anything else (or unset) → 'home' (standard delivery).
 */
function getDeliveryMode(region: 'FR' | 'US' | 'JP' | 'AU' | 'TH' | 'NL'): 'home' | 'pickup' {
  const raw = (process.env[`TEST_DELIVERY_MODE_${region}`] || '').toLowerCase().trim();
  return raw === 'pickup' || raw === 'click-collect' || raw === 'cc' ? 'pickup' : 'home';
}

/**
 * AU card catalog. Default scheme is classic Visa. Switch to EFTPos via TEST_CARD_SCHEME_AU=eftpos.
 * TEST_CARD_NUMBER_AU still takes precedence as a raw override if set.
 */
const AU_CARDS = {
  visa: { number: '4111111111111111', expiry: '03/30', cvv: '737' },
  eftpos: { number: '4089670000000014', expiry: '03/30', cvv: '737' },
} as const;

function getAuCard(): { number: string; expiry: string; cvv: string } {
  const scheme = (process.env.TEST_CARD_SCHEME_AU || 'visa').toLowerCase().trim();
  const card = AU_CARDS[scheme as keyof typeof AU_CARDS] || AU_CARDS.visa;
  return {
    number: process.env.TEST_CARD_NUMBER_AU || card.number,
    expiry: process.env.TEST_CARD_EXPIRY_AU || card.expiry,
    cvv: process.env.TEST_CARD_CVV_AU || card.cvv,
  };
}

/**
 * French region test data
 */
export const TEST_DATA_FR: RegionalTestData = {
  email: process.env.TEST_EMAIL_FR || 'fr_lotfi_test@yopmail.com',
  // SANDBOX fallback - override with TEST_PASSWORD_FR in .env
  password: getEnvVar('TEST_PASSWORD_FR', 'Test1234!', true),
  address: {
    title: 'M',
    firstName: 'Test',
    lastName: 'Lotfi',
    street: '123 Avenue des Champs-Élysées',
    city: 'Paris',
    postalCode: '75008',
    phone: '0612345678',
    country: 'FR',
  },
  payment: {
    // SANDBOX test card - always prefer TEST_CARD_NUMBER_* env
    cardNumber: getEnvVar('TEST_CARD_NUMBER_FR', '4111111111111111', true),
    cardHolder: 'Test Lotfi',
    expiryDate: '03/30',
    cvv: '737',
  },
  productUrl: getProductUrl('FR'),
  deliveryMode: getDeliveryMode('FR'),
};

/**
 * US region test data
 */
export const TEST_DATA_US: RegionalTestData = {
  email: process.env.TEST_EMAIL_US || 'us_lotfi_test@yopmail.com',
  password: process.env.TEST_PASSWORD_US || 'Test1234!',
  address: {
    title: 'Mr',
    firstName: 'Test',
    lastName: 'Lotfi',
    street: '123 Fifth Avenue',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    phone: '6464233453',
    country: 'US',
  },
  payment: {
    cardNumber: '4111111111111111',
    cardHolder: 'Test Lotfi',
    expiryDate: '03/30',
    cvv: '737',
  },
  productUrl: getProductUrl('US'),
  deliveryMode: getDeliveryMode('US'),
};

/**
 * Japan region test data
 */
export const TEST_DATA_JP: RegionalTestData = {
  email: process.env.TEST_EMAIL_JP || 'japan_tva_test1@yopmail.com',
  password: process.env.TEST_PASSWORD_JP || 'Test1234!',
  address: {
    title: 'Mr',
    firstName: 'Test',
    lastName: 'Tanaka',
    firstNameKatakana: 'テスト', // "Test" en katakana
    lastNameKatakana: 'タナカ', // "Tanaka" en katakana
    street: '1-2-3 Shibuya',
    city: 'Tokyo',
    postalCode: '150-0002',
    phone: '09012345678',
    country: 'JP',
  },
  payment: {
    cardNumber: '3569990010095841',
    cardHolder: 'Test Tanaka',
    expiryDate: '03/30',
    cvv: '737',
  },
  productUrl: getProductUrl('JP'),
  deliveryMode: getDeliveryMode('JP'),
};

/**
 * Australia region test data
 */
export const TEST_DATA_AU: RegionalTestData = {
  email: process.env.TEST_EMAIL_AU || 'au_lotfi_test@yopmail.com',
  password: process.env.TEST_PASSWORD_AU || 'Test1234!',
  address: {
    title: (process.env.TEST_TITLE_AU as 'Ms' | 'Mrs' | 'Mr') || 'Ms',
    firstName: process.env.TEST_FIRSTNAME_AU || 'Lotfi',
    lastName: process.env.TEST_LASTNAME_AU || 'Test',
    street: process.env.TEST_STREET_AU || '1 Macquarie Street',
    city: process.env.TEST_CITY_AU || 'Barangaroo',
    state: process.env.TEST_STATE_AU || 'NSW',
    postalCode: process.env.TEST_POSTAL_AU || '2000',
    phone: process.env.TEST_PHONE_AU || '412345678',
    phonePrefix: '+61',
    country: 'AU',
  },
  payment: (() => {
    const card = getAuCard();
    return {
      cardNumber: card.number,
      cardHolder:
        process.env.TEST_CARDHOLDER_AU ||
        `${(process.env.TEST_FIRSTNAME_AU || 'LOTFI').toUpperCase()} ${(process.env.TEST_LASTNAME_AU || 'TEST').toUpperCase()}`,
      expiryDate: card.expiry,
      cvv: card.cvv,
    };
  })(),
  productUrl: getProductUrl('AU'),
  deliveryMode: getDeliveryMode('AU'),
};

/**
 * Thailand region test data — Cybersource payment provider, Bangkok address
 */
export const TEST_DATA_TH: RegionalTestData = {
  email: process.env.TEST_EMAIL_TH || 'th_lotfi_test@yopmail.com',
  password: process.env.TEST_PASSWORD_TH || 'Test1234!',
  address: {
    title: (process.env.TEST_TITLE_TH as 'Ms' | 'Mrs' | 'Mr') || 'Ms',
    firstName: process.env.TEST_FIRSTNAME_TH || 'Lotfi',
    lastName: process.env.TEST_LASTNAME_TH || 'Test',
    street: '999/9 Rama I Road',
    city: 'Pathum Wan', // District (TH lowest admin level — fills "District" text input)
    state: 'BANGKOK', // Province (TH higher admin level — matches PROVINCE select option)
    postalCode: '10330',
    phone: '821234567',
    phonePrefix: '+66',
    country: 'TH',
  },
  payment: {
    cardNumber: '4111111111111111',
    cardHolder:
      process.env.TEST_CARDHOLDER_TH ||
      `${(process.env.TEST_FIRSTNAME_TH || 'LOTFI').toUpperCase()} ${(process.env.TEST_LASTNAME_TH || 'TEST').toUpperCase()}`,
    expiryDate: '03/30',
    cvv: '737',
  },
  productUrl: getProductUrl('TH'),
  deliveryMode: getDeliveryMode('TH'),
};

/**
 * Netherlands region test data
 */
export const TEST_DATA_NL: RegionalTestData = {
  email: process.env.TEST_EMAIL_NL || 'nl_customer_lotfi@yopmail.com',
  // SANDBOX fallback
  password: getEnvVar('TEST_PASSWORD_NL', 'Test1234!', true),
  address: {
    title: 'Mr',
    firstName: process.env.TEST_FIRSTNAME_NL || 'Lotfi',
    lastName: process.env.TEST_LASTNAME_NL || 'Test',
    street: process.env.TEST_STREET_NL || '123 Damrak',
    city: process.env.TEST_CITY_NL || 'Amsterdam',
    postalCode: process.env.TEST_POSTAL_NL || '1012',
    phone: process.env.TEST_PHONE_NL || '0612345678',
    country: 'NL',
  },
  payment: {
    // SANDBOX test card
    cardNumber: getEnvVar('TEST_CARD_NUMBER_NL', '4111111111111111', true),
    cardHolder:
      process.env.TEST_CARDHOLDER_NL ||
      `${(process.env.TEST_FIRSTNAME_NL || 'LOTFI').toUpperCase()} ${(process.env.TEST_LASTNAME_NL || 'TEST').toUpperCase()}`,
    expiryDate: '03/30',
    cvv: '737',
  },
  productUrl: getProductUrl('NL' as any),
  deliveryMode: getDeliveryMode('NL'),
};

/**
 * Get test data for a specific region
 * @param region - Region code (fr, us, jp, au, th, etc.)
 * @returns Regional test data
 */
export function getTestDataForRegion(region: string): RegionalTestData {
  const regionLower = region.toLowerCase();

  if (regionLower.includes('au')) {
    return TEST_DATA_AU;
  } else if (regionLower.includes('th')) {
    return TEST_DATA_TH;
  } else if (regionLower.includes('fr')) {
    return TEST_DATA_FR;
  } else if (regionLower.includes('us')) {
    return TEST_DATA_US;
  } else if (regionLower.includes('jp')) {
    return TEST_DATA_JP;
  } else if (regionLower.includes('nl')) {
    return TEST_DATA_NL;
  }

  // Default to FR
  return TEST_DATA_FR;
}

/**
 * Get test data based on project name
 * @param projectName - Playwright project name (e.g., 'celine-fr', 'celine-us')
 * @returns Regional test data
 */
export function getTestDataForProject(projectName: string): RegionalTestData {
  return getTestDataForRegion(projectName);
}


