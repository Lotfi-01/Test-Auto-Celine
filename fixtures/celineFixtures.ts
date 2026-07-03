import { test as base, Page } from '@playwright/test';
import { CelineHomePage } from '../pages/CelineHomePage';
import { CelineProductPage } from '../pages/CelineProductPage';
import { CelineCheckoutPage } from '../pages/CelineCheckoutPage';
import { TEST_CONFIG, assertE2EEnv } from '../config/testConfig';

/**
 * Extended fixtures for Celine tests
 * These fixtures provide pre-initialized page objects and utilities
 */

type CelineFixtures = {
  homePage: CelineHomePage;
  productPage: CelineProductPage;
  checkoutPage: CelineCheckoutPage;
  authenticatedPage: Page;
};

/**
 * Extend Playwright test with Celine-specific fixtures
 *
 * Sprint 1 addition: the first fixture accessed by any Celine E2E test asserts
 * that the E2E env is populated (HTTP auth + BASE_URL). Unit tests / lint /
 * typecheck do NOT touch these fixtures, so they remain env-free.
 */
export const test = base.extend<CelineFixtures>({
  /**
   * HomePage fixture - automatically initialized
   * Does NOT navigate or accept cookies (use in tests as needed).
   *
   * Sprint 1 guard: `assertE2EEnv()` fires here. It is idempotent — the
   * checkoutPage / productPage fixtures below also guard, so removing this
   * fixture from a future test does not weaken the check.
   */
  homePage: async ({ page }, use) => {
    assertE2EEnv();
    const homePage = new CelineHomePage(page);
    await use(homePage);
  },

  /**
   * ProductPage fixture - automatically initialized
   */
  productPage: async ({ page }, use) => {
    assertE2EEnv();
    const productPage = new CelineProductPage(page);
    await use(productPage);
  },

  /**
   * CheckoutPage fixture - automatically initialized
   */
  checkoutPage: async ({ page }, use) => {
    assertE2EEnv();
    const checkoutPage = new CelineCheckoutPage(page);
    await use(checkoutPage);
  },

  /**
   * Authenticated page - page with HTTP credentials already set
   * Useful for tests that need to bypass the initial auth
   */
  authenticatedPage: async ({ browser }, use) => {
    assertE2EEnv();
    const context = await browser.newContext({
      httpCredentials: {
        username: TEST_CONFIG.auth.username,
        password: TEST_CONFIG.auth.password,
      },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

/**
 * Export expect from @playwright/test for convenience
 */
export { expect } from '@playwright/test';
